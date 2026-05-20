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

import { AbstractionKitError } from 'abstractionkit'

import WalletAccountReadOnlyEvmErc4337, { FEE_TOLERANCE_COEFFICIENT } from './wallet-account-read-only-evm-erc-4337.js'

/** @typedef {import('abstractionkit').UserOperationV7} UserOperationV7 */
/** @typedef {import('abstractionkit').SafeAccountV0_3_0} SafeAccountV0_3_0 */

/**
 * @internal
 * @typedef {Object} TransactionQuote
 * @property {bigint} fee - The estimated fee with tolerance buffer applied.
 * @property {number} createdAt - The timestamp when the quote was created.
 * @property {string} txKey - A serialized key of the transaction used for cache matching.
 * @property {UserOperationV7} [userOp] - The built UserOperation, reusable by sendTransaction.
 * @property {SafeAccountV0_3_0} [smartAccount] - The smart account instance used to build the UserOperation.
 * @property {bigint} [chainId] - The chain id captured at quote time, used to sign the cached UserOperation for the right network.
 */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('@tetherto/wdk-wallet-evm').KeyPair} KeyPair */

/** @typedef {import('@tetherto/wdk-wallet-evm').EvmTransaction} EvmTransaction */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferResult} TransferResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').ApproveOptions} ApproveOptions */

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
   * @param {EvmTransaction | EvmTransaction[]} tx - The transaction, or an array of multiple transactions to send in batch.
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
      this._quoteCache.set(txKey, { fee: 0n, createdAt: Date.now(), txKey })
      return { fee: 0n }
    }

    const gasCostResult = await this._getUserOperationGasCost([tx].flat(), mergedConfig)

    const fee = BigInt(gasCostResult.fee) * FEE_TOLERANCE_COEFFICIENT / 100n

    this._quoteCache.set(txKey, {
      fee,
      createdAt: Date.now(),
      txKey,
      userOp: gasCostResult.userOp,
      smartAccount: gasCostResult.smartAccount,
      chainId: gasCostResult.chainId
    })

    return { fee }
  }

  /**
   * Sends a transaction.
   *
   * @param {EvmTransaction | EvmTransaction[]} tx -  The transaction, or an array of multiple transactions to send in batch.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<TransactionResult>} The transaction's result.
   */
  async sendTransaction (tx, config) {
    const mergedConfig = { ...this._config, ...config }

    if (config) {
      this._validateConfig(mergedConfig)
    }

    let cached = this._consumeCachedQuote(tx)
    if (!cached) {
      await this.quoteSendTransaction(tx, config)
      cached = this._consumeCachedQuote(tx)
    }

    const fee = cached.fee

    const hash = await this._sendUserOperation([tx].flat(), { config: mergedConfig, cachedBuild: cached })

    await this._bumpCachedNonces()

    return { hash, fee }
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

    let cached = this._consumeCachedQuote(tx)
    if (!cached) {
      await this.quoteSendTransaction(tx, config)
      cached = this._consumeCachedQuote(tx)
    }

    const fee = cached.fee

    if (!isSponsored && transferMaxFee !== undefined && fee >= transferMaxFee) {
      throw new Error('Exceeded maximum fee cost for transfer operation.')
    }

    const hash = await this._sendUserOperation([tx], { config: mergedConfig, cachedBuild: cached })

    await this._bumpCachedNonces()

    return { hash, fee }
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
  async _bumpCachedNonces () {
    const quotesWithUserOp = [...this._quoteCache.values()].filter(q => q.userOp)

    if (quotesWithUserOp.length === 0) return

    const preBumpNonce = quotesWithUserOp[0].userOp.nonce

    for (const quote of quotesWithUserOp) {
      quote.userOp.nonce += 1n
    }

    const { smartAccount } = quotesWithUserOp[0]
    const providerRpc = WalletAccountReadOnlyEvmErc4337._resolveProviderRpc(this._config.provider)
    const onChainNonce = await smartAccount.getNonce(providerRpc)

    if (onChainNonce > preBumpNonce + 1n) {
      this._quoteCache.clear()
    }
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
  async _sendUserOperation (txs, { config, cachedBuild }) {
    try {
      const { userOp, smartAccount, chainId } = cachedBuild?.userOp
        ? cachedBuild
        : await this._buildUserOperation(WalletAccountReadOnlyEvmErc4337._toMetaTransactions(txs), config)

      const signer = {
        address: this._ownerAccountAddress,
        signHash: async (hash) => this._ownerAccount._account.signingKey.sign(hash).serialized
      }
      userOp.signature = await smartAccount.signUserOperationWithSigners(
        userOp,
        [signer],
        chainId
      )

      return await this._getBundler().sendUserOperation(userOp, smartAccount.entrypointAddress)
    } catch (err) {
      if (err instanceof AbstractionKitError && err.message.includes('AA50')) {
        throw new Error('Not enough funds on the safe account to repay the paymaster.')
      }
      throw err
    }
  }
}
