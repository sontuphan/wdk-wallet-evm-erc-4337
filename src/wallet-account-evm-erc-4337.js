// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { Contract } from 'ethers'

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

import { AbstractionKitError, ENTRYPOINT_V7, fetchAccountNonce } from 'abstractionkit'

import WalletAccountReadOnlyEvmErc4337, { FEE_TOLERANCE_COEFFICIENT } from './wallet-account-read-only-evm-erc-4337.js'

/** @typedef {import('abstractionkit').UserOperationV7} UserOperationV7 */
/** @typedef {import('abstractionkit').SafeAccountV0_3_0} SafeAccountV0_3_0 */

/**
 * @internal
 * @typedef {Object} TransactionQuote
 * @property {bigint} fee - The estimated fee with tolerance buffer applied.
 * @property {number} createdAt - The timestamp when the quote was created.
 * @property {UserOperationV7} [userOp] - The built UserOperation, reusable by sendTransaction.
 * @property {SafeAccountV0_3_0} [smartAccount] - The smart account instance used to build the UserOperation.
 * @property {bigint} [chainId] - The chain id captured at quote time, used to sign the cached UserOperation for the right network.
 */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('@tetherto/wdk-wallet-evm').KeyPair} KeyPair */

/** @typedef {import('@tetherto/wdk-wallet-evm').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferResult} TransferResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').ApproveOptions} ApproveOptions */

/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').EvmErc4337Transaction} EvmErc4337Transaction */
/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').EvmErc4337WalletConfig} EvmErc4337WalletConfig */
/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').TypedData} TypedData */
/** @typedef {import('./wallet-account-read-only-evm-erc-4337.js').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

const QUOTE_MAX_AGE_MS = 2 * 60 * 1_000

const USDT_MAINNET_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

/** @implements {IWalletAccount} */
export default class WalletAccountEvmErc4337 extends WalletAccountReadOnlyEvmErc4337 {
  /**
   * Creates a new evm [erc-4337](https://www.erc4337.io/docs) wallet account.
   *
   * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase.
   * @param {string} path - The BIP-44 derivation path (e.g. "0'/0/0").
   * @param {EvmErc4337WalletConfig} config - The configuration object.
   */
  constructor (seed, path, config) {
    const ownerAccount = new WalletAccountEvm(seed, path, config)

    super(ownerAccount._address, config)

    /**
     * The evm erc-4337 wallet account configuration.
     *
     * @protected
     * @type {EvmErc4337WalletConfig}
     */
    this._config = config

    /** @private */
    this._ownerAccount = ownerAccount

    /**
     * Cached quotes from fee estimations, keyed by serialized transaction.
     *
     * @private
     * @type {Map<string, TransactionQuote>}
     */
    this._quoteCache = new Map()

    /** @private */
    this._nextNonce = undefined

    /** @private */
    this._nonceLock = Promise.resolve()
  }

  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index () {
    return this._ownerAccount.index
  }

  /**
   * The derivation path of this account (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
   *
   * @type {string}
   */
  get path () {
    return this._ownerAccount.path
  }

  /**
   * The account's key pair.
   *
   * The uint8 arrays are bound to the wallet account, so any external change will reflect to the internal representation. For this reason,
   * it's strongly recommended to treat the key pair as a read-only view of the keys. While it's still technically possible to alter their
   * content, client code should never do so.
   *
   * @type {KeyPair}
   */
  get keyPair () {
    return this._ownerAccount.keyPair
  }

  /**
   * Signs a message.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature.
   */
  async sign (message) {
    return await this._ownerAccount.sign(message)
  }

  /**
   * Signs typed data according to EIP-712.
   *
   * @param {TypedData} typedData - The typed data to sign.
   * @returns {Promise<string>} The typed data signature.
   */
  async signTypedData ({ domain, types, message }) {
    return await this._ownerAccount.signTypedData({ domain, types, message })
  }

  /**
   * Signs a user operation built from the given transaction.
   *
   * @param {EvmErc4337Transaction} tx - The transaction to include in the user operation.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<UserOperationV7>} The signed user operation.
   */
  async signTransaction (tx, config) {
    const mergedConfig = { ...this._config, ...config }

    if (config) {
      this._validateConfig(mergedConfig)
    }

    const { quote } = await this._resolveQuote(tx, config)
    const prepared = await this._prepareForSubmit(quote, [tx], mergedConfig)

    const { userOp } = await this._signUserOperation([tx], { config: mergedConfig, cachedBuild: prepared })

    this._quoteCache.clear()

    return userOp
  }

  /**
   * Approves a specific amount of tokens to a spender.
   *
   * @param {ApproveOptions} options - The approve options.
   * @returns {Promise<TransactionResult>} - The transaction's result.
   * @throws {Error} - If trying to approve usdts on ethereum with allowance not equal to zero (due to the usdt allowance reset requirement).
   */
  async approve (options) {
    if (!this._ownerAccount._provider) {
      throw new Error('The wallet must be connected to a provider to approve funds.')
    }

    const { token, spender, amount } = options
    const chainId = await this._getChainId()

    if (chainId === 1n && token.toLowerCase() === USDT_MAINNET_ADDRESS.toLowerCase()) {
      const currentAllowance = await this.getAllowance(token, spender)
      if (currentAllowance > 0n && BigInt(amount) > 0n) {
        throw new Error(
          'USDT requires the current allowance to be reset to 0 before setting a new non-zero value. Please send an "approve" transaction with an amount of 0 first.'
        )
      }
    }

    const abi = ['function approve(address spender, uint256 amount) returns (bool)']
    const contract = new Contract(token, abi, this._ownerAccount._provider)

    const tx = {
      to: token,
      value: 0,
      data: contract.interface.encodeFunctionData('approve', [spender, amount])
    }

    return await this.sendTransaction(tx)
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * The result is cached internally for up to 2 minutes. If `sendTransaction` is called with the
   * same transaction within that window, the cached fee is reused without an additional RPC round-trip.
   *
   * In a batched call (`tx` passed as `[tx1, tx2, ...]`), only the gas overrides on `tx1` are
   * honored — a UserOperation has a single set of gas fields regardless of how many calls it batches.
   *
   * @param {EvmErc4337Transaction | EvmErc4337Transaction[]} tx - The transaction, or an array of multiple transactions to send in batch.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   */
  async quoteSendTransaction (tx, config) {
    const mergedConfig = { ...this._config, ...config }

    if (config) {
      this._validateConfig(mergedConfig)
    }

    const txKey = WalletAccountEvmErc4337._getTxKey(tx)

    if (mergedConfig.isSponsored) {
      this._quoteCache.set(txKey, { fee: 0n, createdAt: Date.now() })
      return { fee: 0n }
    }

    const gasCostResult = await this._getUserOperationGasCost([tx].flat(), mergedConfig)

    const fee = BigInt(gasCostResult.fee) * FEE_TOLERANCE_COEFFICIENT / 100n

    this._quoteCache.set(txKey, {
      fee,
      createdAt: Date.now(),
      userOp: gasCostResult.userOp,
      smartAccount: gasCostResult.smartAccount,
      chainId: gasCostResult.chainId
    })

    return { fee }
  }

  /**
   * Sends a transaction.
   *
   * In a batched call (`tx` passed as `[tx1, tx2, ...]`), only the gas overrides on `tx1` are
   * honored — a UserOperation has a single set of gas fields regardless of how many calls it batches.
   *
   * @param {EvmErc4337Transaction | EvmErc4337Transaction[]} tx -  The transaction, or an array of multiple transactions to send in batch.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<TransactionResult>} The transaction's result.
   */
  async sendTransaction (tx, config) {
    const mergedConfig = { ...this._config, ...config }

    if (config) {
      this._validateConfig(mergedConfig)
    }

    const txs = [tx].flat()
    const resolved = await this._resolveQuote(tx, config)
    let prepared = await this._prepareForSubmit(resolved.quote, txs, mergedConfig)

    try {
      const hash = await this._sendUserOperation(txs, { config: mergedConfig, cachedBuild: prepared })
      return { hash, fee: prepared.fee }
    } catch (error) {
      this._maybeResyncOnRejection(error)
      if (!resolved.fromCache || !WalletAccountEvmErc4337._isRetriableSendError(error)) {
        throw error
      }

      const fresh = await this._freshQuote(tx, config)
      prepared = await this._prepareForSubmit(fresh, txs, mergedConfig)

      try {
        const hash = await this._sendUserOperation(txs, { config: mergedConfig, cachedBuild: prepared })
        return { hash, fee: prepared.fee }
      } catch (retryError) {
        this._maybeResyncOnRejection(retryError)
        throw retryError
      }
    }
  }

  /**
   * Transfers a token to another address.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<TransferResult>} The transfer's result.
   */
  async transfer (options, config) {
    const mergedConfig = { ...this._config, ...config }

    if (config) {
      this._validateConfig(mergedConfig)
    }

    const { isSponsored, transferMaxFee } = mergedConfig

    const tx = await WalletAccountEvm._getTransferTransaction(options)

    const txs = [tx]
    const resolved = await this._resolveQuote(tx, config)
    let prepared = await this._prepareForSubmit(resolved.quote, txs, mergedConfig)

    if (!isSponsored && transferMaxFee !== undefined && prepared.fee >= transferMaxFee) {
      this._nextNonce = undefined
      throw new Error('Exceeded maximum fee cost for transfer operation.')
    }

    try {
      const hash = await this._sendUserOperation(txs, { config: mergedConfig, cachedBuild: prepared })
      return { hash, fee: prepared.fee }
    } catch (error) {
      this._maybeResyncOnRejection(error)
      if (!resolved.fromCache || !WalletAccountEvmErc4337._isRetriableSendError(error)) {
        throw error
      }

      const fresh = await this._freshQuote(tx, config)
      prepared = await this._prepareForSubmit(fresh, txs, mergedConfig)

      if (!isSponsored && transferMaxFee !== undefined && prepared.fee >= transferMaxFee) {
        this._nextNonce = undefined
        throw new Error('Exceeded maximum fee cost for transfer operation.')
      }

      try {
        const hash = await this._sendUserOperation(txs, { config: mergedConfig, cachedBuild: prepared })
        return { hash, fee: prepared.fee }
      } catch (retryError) {
        this._maybeResyncOnRejection(retryError)
        throw retryError
      }
    }
  }

  /**
   * Returns a read-only copy of the account.
   *
   * @returns {Promise<WalletAccountReadOnlyEvmErc4337>} The read-only account.
   */
  async toReadOnlyAccount () {
    const address = await this._ownerAccount.getAddress()

    const readOnlyAccount = new WalletAccountReadOnlyEvmErc4337(address, this._config)

    return readOnlyAccount
  }

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    this._ownerAccount.dispose()
  }

  /** @private */
  async _resolveQuote (tx, config) {
    let cached = this._consumeCachedQuote(tx)

    if (!cached) {
      await this.quoteSendTransaction(tx, config)
      cached = this._consumeCachedQuote(tx)
      return { quote: cached, fromCache: false }
    }

    return { quote: cached, fromCache: cached.userOp != null }
  }

  /** @private */
  async _allocateNonce () {
    const prev = this._nonceLock
    let release = () => {}
    this._nonceLock = new Promise(resolve => { release = resolve })
    try {
      await prev
      const onChain = await fetchAccountNonce(this._provider, this._config.entryPointAddress ?? ENTRYPOINT_V7, this._address)
      const next = this._nextNonce !== undefined && this._nextNonce > onChain ? this._nextNonce : onChain
      this._nextNonce = next + 1n
      return next
    } finally {
      release()
    }
  }

  /** @private */
  _maybeResyncOnRejection (error) {
    if (WalletAccountEvmErc4337._isPreAcceptanceError(error)) {
      this._nextNonce = undefined
    }
  }

  /** @private */
  async _prepareForSubmit (quote, txs, mergedConfig) {
    const allocatedNonce = await this._allocateNonce()
    try {
      return await this._prepareForSend(quote, txs, allocatedNonce, mergedConfig)
    } catch (error) {
      this._nextNonce = undefined
      throw error
    }
  }

  /** @private */
  async _prepareForSend (quote, txs, allocatedNonce, mergedConfig) {
    if (quote.userOp && quote.userOp.nonce === allocatedNonce) {
      return quote
    }
    if (quote.userOp) {
      return await this._rebindCachedQuoteNonce(quote, allocatedNonce, mergedConfig)
    }
    return await this._buildAtNonce(quote, txs, allocatedNonce, mergedConfig)
  }

  /** @private */
  async _buildAtNonce (quote, txs, allocatedNonce, config) {
    const overrides = {
      nonce: allocatedNonce,
      ...WalletAccountReadOnlyEvmErc4337._extractGasOverrides(txs[0])
    }

    const result = await this._buildUserOperation(
      WalletAccountReadOnlyEvmErc4337._toMetaTransactions(txs),
      config,
      overrides
    )

    return { ...quote, userOp: result.userOp, smartAccount: result.smartAccount, chainId: result.chainId }
  }

  /** @private */
  async _freshQuote (tx, config) {
    await this.quoteSendTransaction(tx, config)
    return this._consumeCachedQuote(tx)
  }

  /** @private */
  static _isRetriableSendError (error) {
    if (!(error instanceof AbstractionKitError)) return false

    const message = `${error.message ?? ''} ${error.cause?.message ?? ''}`.toLowerCase()

    return [
      'aa10', 'aa13', 'aa14', 'aa22', 'aa23', 'aa24', 'aa25', 'aa26',
      'nonce', 'already known', 'replacement underpriced', 'underpriced',
      'fee too low', 'sender already constructed'
    ].some(marker => message.includes(marker))
  }

  /** @private */
  async _rebindCachedQuoteNonce (cached, allocatedNonce, config) {
    cached.userOp.nonce = allocatedNonce

    if (allocatedNonce > 0n && cached.userOp.factory != null) {
      cached.userOp.factory = null
      cached.userOp.factoryData = null
    }

    const mode = WalletAccountReadOnlyEvmErc4337._resolvePaymasterMode(config)
    if (mode === 'native') {
      return cached
    }

    const txOverrides = {}
    if (cached.userOp.callGasLimit !== undefined) txOverrides.callGasLimit = cached.userOp.callGasLimit
    if (cached.userOp.verificationGasLimit !== undefined) txOverrides.verificationGasLimit = cached.userOp.verificationGasLimit
    if (cached.userOp.preVerificationGas !== undefined) txOverrides.preVerificationGas = cached.userOp.preVerificationGas

    const { userOp, tokenQuote } = await this._applyPaymasterToUserOp({
      mode,
      smartAccount: cached.smartAccount,
      userOp: cached.userOp,
      config,
      chainId: cached.chainId,
      txOverrides
    })

    cached.userOp = userOp
    if (tokenQuote) {
      cached.fee = BigInt(tokenQuote.tokenCost) * FEE_TOLERANCE_COEFFICIENT / 100n
    }

    return cached
  }

  /** @private */
  static _isPreAcceptanceError (error) {
    if (error instanceof AbstractionKitError) {
      const message = `${error.message ?? ''} ${error.cause?.message ?? ''}`.toLowerCase()
      return [
        'aa10', 'aa13', 'aa14', 'aa21', 'aa22', 'aa23', 'aa24', 'aa25', 'aa26',
        'aa31', 'aa32', 'aa33', 'aa34', 'aa40', 'aa41', 'aa50', 'aa51',
        'nonce', 'already known', 'replacement underpriced', 'underpriced',
        'fee too low', 'sender already constructed'
      ].some(marker => message.includes(marker))
    }
    return typeof error?.message === 'string' && error.message.includes('Not enough funds')
  }

  /** @private */
  static _getTxKey (tx) {
    return JSON.stringify([tx].flat(), (_, v) => typeof v === 'bigint' ? v.toString() : v)
  }

  /** @private */
  _consumeCachedQuote (tx) {
    const txKey = WalletAccountEvmErc4337._getTxKey(tx)
    const quote = this._quoteCache.get(txKey)

    if (!quote) {
      return undefined
    }

    this._quoteCache.delete(txKey)

    if (Date.now() - quote.createdAt > QUOTE_MAX_AGE_MS) {
      return undefined
    }

    return quote
  }

  /** @private */
  async _signUserOperation (txs, { config, cachedBuild }) {
    const { userOp, smartAccount, chainId } = cachedBuild?.userOp
      ? cachedBuild
      : await this._buildUserOperation(
        WalletAccountReadOnlyEvmErc4337._toMetaTransactions(txs),
        config,
        WalletAccountReadOnlyEvmErc4337._extractGasOverrides(txs[0])
      )

    const signer = {
      address: this._ownerAccountAddress,
      signHash: async (hash) => this._ownerAccount._account.signingKey.sign(hash).serialized
    }
    userOp.signature = await smartAccount.signUserOperationWithSigners(
      userOp,
      [signer],
      chainId
    )

    return { userOp, smartAccount, chainId }
  }

  /** @private */
  async _sendUserOperation (txs, { config, cachedBuild }) {
    try {
      const { userOp, smartAccount } = await this._signUserOperation(txs, { config, cachedBuild })

      return await this._getBundler().sendUserOperation(userOp, smartAccount.entrypointAddress)
    } catch (err) {
      if (err instanceof AbstractionKitError && err.message.includes('AA50')) {
        throw new Error('Not enough funds on the safe account to repay the paymaster.')
      }
      throw err
    }
  }
}
