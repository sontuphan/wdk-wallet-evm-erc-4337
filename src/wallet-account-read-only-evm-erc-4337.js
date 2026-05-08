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

import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'

import { WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'

import {
  // eslint-disable-next-line camelcase
  SafeAccountV0_3_0 as SafeAccount030,
  AbstractionKitError,
  Bundler,
  Erc7677Paymaster,
  ENTRYPOINT_V7,
  calculateUserOperationMaxGasCost
} from 'abstractionkit'

/** @typedef {import('abstractionkit').InitCodeOverrides} InitCodeOverrides */
/** @typedef {import('abstractionkit').MetaTransaction} MetaTransaction */
/** @typedef {import('abstractionkit').SafeAccountV0_3_0} SafeAccountV0_3_0 */

import { ConfigurationError } from './errors.js'

const PaymasterMode = {
  NATIVE: 'native',
  SPONSORED: 'sponsored',
  TOKEN: 'token'
}

export const FEE_TOLERANCE_COEFFICIENT = 120n

/** @typedef {import('ethers').Eip1193Provider} Eip1193Provider */

/** @typedef {import('@tetherto/wdk-wallet-evm').EvmTransaction} EvmTransaction */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet-evm').TransferResult} TransferResult */

/** @typedef {import('@tetherto/wdk-wallet-evm').EvmTransactionReceipt} EvmTransactionReceipt */

/** @typedef {import('@tetherto/wdk-wallet-evm').TypedData} TypedData */

/** @typedef {import('abstractionkit').UserOperationReceiptResult} UserOperationReceipt */
/** @typedef {import('abstractionkit').UserOperationV7} UserOperationV7 */
/** @typedef {import('abstractionkit').TokenQuote} TokenQuote */

/**
 * @typedef {Object} TransactionQuote
 * @property {bigint} fee - The estimated fee with tolerance buffer applied.
 * @property {number} createdAt - The timestamp when the quote was created.
 * @property {string} txKey - A serialized key of the transaction used for cache matching.
 * @property {UserOperationV7} [userOp] - The built UserOperation, reusable by sendTransaction.
 * @property {SafeAccountV0_3_0} [smartAccount] - The smart account instance used to build the UserOperation.
 * @property {bigint} [chainId] - The chain id.
 */

/**
 * @typedef {Object} BuiltUserOperation
 * @property {UserOperationV7} userOp - The fully-populated UserOperation ready to sign.
 * @property {SafeAccountV0_3_0} smartAccount - The Safe account that will execute the operation.
 * @property {'native' | 'sponsored' | 'token'} mode - The paymaster mode used to build the operation.
 * @property {bigint} chainId - The chain id captured at build time.
 * @property {TokenQuote} [tokenQuote] - The paymaster token quote, present only in token mode.
 */

/**
 * @typedef {Object} OnChainIdentifier
 * @property {string} project - The project name included in the 50-byte on-chain marker.
 * @property {'Web' | 'Mobile' | 'Safe App' | 'Widget'} [platform] - The platform type (default: 'Web').
 * @property {string} [tool] - The tool name used to create the UserOperation.
 * @property {string} [toolVersion] - The version of the tool.
 */

/**
 * @typedef {Object} EvmErc4337WalletCommonConfig
 * @property {number} chainId - The blockchain's id (e.g., 1 for ethereum).
 * @property {string | Eip1193Provider} provider - The url of the rpc provider, or an instance of a class that implements eip-1193.
 * @property {string} bundlerUrl - The url of the bundler service.
 * @property {string} safeModulesVersion - The safe modules version.
 * @property {OnChainIdentifier | string} [onChainIdentifier] - Optional on-chain identifier. Appends a 50-byte project marker to every UserOperation callData. Pass a string to reuse it as the project name, or a full object for more control.
 */

/**
 * @typedef {Object} EvmErc4337WalletPaymasterTokenConfig
 * @property {false} [isSponsored] - Whether the paymaster is sponsoring the account.
 * @property {false} [useNativeCoins] - Whether to use native coins instead of a paymaster to pay for gas fees.
 * @property {string} paymasterUrl - The url of the paymaster service.
 * @property {string} paymasterAddress - The address of the paymaster smart contract.
 * @property {Object} paymasterToken - The paymaster token configuration.
 * @property {string} paymasterToken.address - The address of the paymaster token.
 * @property {number | bigint} [transferMaxFee] - The maximum fee amount for transfer operations.
 */

/**
 * @typedef {Object} EvmErc4337WalletSponsorshipPolicyConfig
 * @property {true} isSponsored - Whether the paymaster is sponsoring the account.
 * @property {false} [useNativeCoins] - Whether to use native coins instead of a paymaster to pay for gas fees.
 * @property {string} paymasterUrl - The url of the paymaster service.
 * @property {string} [sponsorshipPolicyId] - The sponsorship policy id.
 */

/**
 * @typedef {Object} EvmErc4337WalletNativeCoinsConfig
 * @property {false} [isSponsored] - Whether the paymaster is sponsoring the account.
 * @property {true} useNativeCoins - Whether to use native coins instead of a paymaster to pay for gas fees.
 * @property {number | bigint} [transferMaxFee] - The maximum fee amount for transfer operations.
 */

/**
 * @typedef {EvmErc4337WalletCommonConfig & (EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig)} EvmErc4337WalletConfig
 */

export const SALT_NONCE = '0x69b348339eea4ed93f9d11931c3b894c8f9d8c7663a053024b11cb7eb4e5a1f6'

const SAFE_MODULES_MAP = {
  '0.3.0': {
    safe4337ModuleAddress: '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
    safeModuleSetupAddress: '0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47'
  }
}

export default class WalletAccountReadOnlyEvmErc4337 extends WalletAccountReadOnly {
  /**
   * Creates a new read-only evm [erc-4337](https://www.erc4337.io/docs) wallet account.
   *
   * @param {string} address - The evm account's address.
   * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The configuration object.
   */
  constructor (address, config) {
    if (!SAFE_MODULES_MAP[config.safeModulesVersion]) {
      throw new ConfigurationError(`Unsupported safe modules version: ${config.safeModulesVersion}`)
    }

    const safeAddress = WalletAccountReadOnlyEvmErc4337.predictSafeAddress(address, config)

    super(safeAddress)

    /**
     * The read-only evm erc-4337 wallet account configuration.
     *
     * @protected
     * @type {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>}
     */
    this._config = config

    /**
     * Cached AbstractionKit bundler.
     *
     * @protected
     * @type {Bundler | undefined}
     */
    this._bundler = undefined

    /**
     * The chain id.
     *
     * @protected
     * @type {bigint | undefined}
     */
    this._chainId = undefined

    /**
     * Cached Erc7677Paymaster instances keyed by URL.
     *
     * @protected
     * @type {Map<string, Erc7677Paymaster>}
     */
    this._paymasters = new Map()

    /** @private */
    this._ownerAccountAddress = address
  }

  /**
   * Predicts the address of a safe account.
   *
   * @param {string} owner - The safe owner's address.
   * @param {Pick<EvmErc4337WalletConfig, 'safeModulesVersion' | 'onChainIdentifier'>} config - The safe configuration.
   * @returns {string} The Safe address.
   */
  static predictSafeAddress (owner, config) {
    const overrides = WalletAccountReadOnlyEvmErc4337._getInitCodeOverrides(config)
    return SafeAccount030.createAccountAddress([owner], overrides)
  }

  /**
   * Returns the account's eth balance.
   *
   * @returns {Promise<bigint>} The eth balance (in weis).
   */
  async getBalance () {
    const evmReadOnlyAccount = await this._getEvmReadOnlyAccount()

    return await evmReadOnlyAccount.getBalance()
  }

  /**
   * Returns the account balance for a specific token.
   *
   * @param {string} tokenAddress - The smart contract address of the token.
   * @returns {Promise<bigint>} The token balance (in base unit).
   */
  async getTokenBalance (tokenAddress) {
    const evmReadOnlyAccount = await this._getEvmReadOnlyAccount()

    return await evmReadOnlyAccount.getTokenBalance(tokenAddress)
  }

  /**
   * Returns the account balances for multiple tokens.
   *
   * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
   * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
   */
  async getTokenBalances (tokenAddresses) {
    const evmReadOnlyAccount = await this._getEvmReadOnlyAccount()

    return await evmReadOnlyAccount.getTokenBalances(tokenAddresses)
  }

  /**
   * Returns the account's balance for the paymaster token provided in the wallet account configuration.
   *
   * @returns {Promise<bigint>} The paymaster token balance (in base unit).
   */
  async getPaymasterTokenBalance () {
    const { paymasterToken } = this._config

    if (!paymasterToken) {
      throw new Error('Paymaster token is not configured.')
    }

    return await this.getTokenBalance(paymasterToken.address)
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

    const { isSponsored } = mergedConfig

    if (isSponsored) {
      return { fee: 0n }
    }

    const gasCostResult = await this._getUserOperationGasCost([tx].flat(), mergedConfig)

    const fee = BigInt(gasCostResult.fee) * FEE_TOLERANCE_COEFFICIENT / 100n

    return { fee }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * The result is cached internally for up to 2 minutes. If `transfer` is called with the
   * same transaction within that window, the cached fee is reused without an additional RPC round-trip.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   */
  async quoteTransfer (options, config) {
    const tx = await WalletAccountReadOnlyEvm._getTransferTransaction(options)

    const result = await this.quoteSendTransaction(tx, config)

    return result
  }

  /**
   * Returns a transaction's receipt.
   *
   * @param {string} hash - The user operation hash.
   * @returns {Promise<EvmTransactionReceipt | null>} – The receipt, or null if the transaction has not been included in a block yet.
   */
  async getTransactionReceipt (hash) {
    const bundler = this._getBundler()
    const evmReadOnlyAccount = await this._getEvmReadOnlyAccount()

    const result = await bundler.getUserOperationByHash(hash)
    if (!result || !result.transactionHash) return null

    return await evmReadOnlyAccount.getTransactionReceipt(result.transactionHash)
  }

  /**
   * Returns a user operation's receipt.
   *
   * @param {string} hash - The user operation hash.
   * @returns {Promise<UserOperationReceipt | null>} – The receipt, or null if the user operation has not been included in a block yet.
   */
  async getUserOperationReceipt (hash) {
    const bundler = this._getBundler()

    return await bundler.getUserOperationReceipt(hash)
  }

  /**
   * Returns the current allowance for the given token and spender.
   *
   * @param {string} token - The token's address.
   * @param {string} spender - The spender's address.
   * @returns {Promise<bigint>} The allowance.
   */
  async getAllowance (token, spender) {
    const readOnlyAccount = await this._getEvmReadOnlyAccount()

    return await readOnlyAccount.getAllowance(token, spender)
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    const evmReadOnlyAccount = new WalletAccountReadOnlyEvm(this._ownerAccountAddress, this._config)
    return await evmReadOnlyAccount.verify(message, signature)
  }

  /**
   * Verifies a typed data signature.
   *
   * @param {TypedData} typedData - The typed data to verify.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verifyTypedData (typedData, signature) {
    const evmReadOnlyAccount = new WalletAccountReadOnlyEvm(this._ownerAccountAddress, this._config)

    return await evmReadOnlyAccount.verifyTypedData(typedData, signature)
  }

  /**
   * Validates the configuration to ensure all required fields are present.
   *
   * @protected
   * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The configuration to validate.
   * @throws {ConfigurationError} If the configuration is invalid or has missing required fields.
   * @returns {void}
   */
  _validateConfig (config) {
    const { isSponsored, useNativeCoins, paymasterUrl, paymasterAddress, paymasterToken } = config
    const missingFields = []

    if (isSponsored && useNativeCoins) {
      throw new ConfigurationError("Cannot use both 'isSponsored: true' and 'useNativeCoins: true'. Please use only one.")
    }

    if (!isSponsored && !useNativeCoins) {
      if (!paymasterUrl) {
        missingFields.push('paymasterUrl')
      }
      if (!paymasterAddress) {
        missingFields.push('paymasterAddress')
      }
      if (!paymasterToken) {
        missingFields.push('paymasterToken')
      }

      if (missingFields.length > 0) {
        throw new ConfigurationError(`Missing required paymaster token configuration fields: ${missingFields.join(', ')}.`)
      }
    } else if (isSponsored) {
      if (!paymasterUrl) {
        missingFields.push('paymasterUrl')
      }

      if (missingFields.length > 0) {
        throw new ConfigurationError(`Missing required sponsorship policy configuration fields: ${missingFields.join(', ')}.`)
      }
    }
  }

  /**
   * Builds a safe account instance for the current owner.
   *
   * @protected
   * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} [config] - The wallet configuration. Defaults to the instance configuration.
   * @returns {Promise<SafeAccountV0_3_0>} The safe account instance.
   */
  async _getSmartAccount (config = this._config) {
    if (this._deployedSmartAccount) return this._deployedSmartAccount

    const overrides = WalletAccountReadOnlyEvmErc4337._getInitCodeOverrides(config)
    const safeAddress = await this.getAddress()
    const providerRpc = WalletAccountReadOnlyEvmErc4337._resolveProviderRpc(config.provider)

    if (await SafeAccount030.isDeployed(safeAddress, providerRpc)) {
      this._deployedSmartAccount = new SafeAccount030(safeAddress, overrides)
      return this._deployedSmartAccount
    }

    return SafeAccount030.initializeNewAccount([this._ownerAccountAddress], overrides)
  }

  /**
   * Returns an AbstractionKit Bundler for querying UserOperations.
   *
   * @protected
   * @returns {Bundler} The bundler.
   */
  _getBundler () {
    if (!this._bundler) {
      this._bundler = new Bundler(this._config.bundlerUrl)
    }
    return this._bundler
  }

  /** @private */
  _getPaymaster (url, options = {}) {
    if (!this._paymasters.has(url)) {
      const provider = WalletAccountReadOnlyEvmErc4337._detectProvider(url)
      this._paymasters.set(url, new Erc7677Paymaster(url, { ...options, provider }))
    }
    return this._paymasters.get(url)
  }

  /**
   * Returns the chain id.
   *
   * @protected
   * @returns {Promise<bigint>} - The chain id.
   */
  async _getChainId () {
    if (!this._chainId) {
      const evmReadOnlyAccount = await this._getEvmReadOnlyAccount()

      const { chainId } = await evmReadOnlyAccount._provider.getNetwork()

      this._chainId = chainId
    }

    return this._chainId
  }

  /** @private */
  async _getEvmReadOnlyAccount () {
    if (!this._evmReadOnlyAccount) {
      const address = await this.getAddress()
      this._evmReadOnlyAccount = new WalletAccountReadOnlyEvm(address, this._config)
    }

    return this._evmReadOnlyAccount
  }

  /**
   * Returns a serialized key for transaction cache matching.
   *
   * @protected
   * @param {EvmTransaction | EvmTransaction[]} tx - The transaction(s) to serialize.
   * @returns {string} The serialized transaction key.
   */
  static _getTxKey (tx) {
    return JSON.stringify([tx].flat(), (_, v) => typeof v === 'bigint' ? v.toString() : v)
  }

  /**
   * Converts EVM transactions to AbstractionKit MetaTransaction calls.
   *
   * @protected
   * @param {EvmTransaction[]} txs - The transactions to convert.
   * @returns {MetaTransaction[]} The calls array for createUserOperation.
   */
  static _toMetaTransactions (txs) {
    return txs.map(tx => ({
      to: tx.to,
      value: tx.value !== undefined ? BigInt(tx.value) : 0n,
      data: tx.data ?? '0x'
    }))
  }

  /**
   * Builds the init code overrides from the wallet configuration.
   *
   * @protected
   * @param {Pick<EvmErc4337WalletConfig, 'safeModulesVersion' | 'onChainIdentifier'>} config - The wallet configuration fields used for init code generation.
   * @returns {InitCodeOverrides} The init code overrides for SafeAccount creation.
   */
  static _getInitCodeOverrides (config) {
    const { safeModulesVersion, onChainIdentifier } = config
    const modules = SAFE_MODULES_MAP[safeModulesVersion]

    const overrides = {
      c2Nonce: BigInt(SALT_NONCE),
      entrypointAddress: ENTRYPOINT_V7,
      safe4337ModuleAddress: modules.safe4337ModuleAddress,
      safeModuleSetupAddress: modules.safeModuleSetupAddress
    }

    if (onChainIdentifier) {
      overrides.onChainIdentifierParams = typeof onChainIdentifier === 'string'
        ? { project: onChainIdentifier }
        : onChainIdentifier
    }

    return overrides
  }

  /**
   * Builds a UserOperation with paymaster fields applied.
   *
   * @protected
   * @param {MetaTransaction[]} calls - The meta-transactions to include in the UserOperation.
   * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The wallet configuration.
   * @returns {Promise<BuiltUserOperation>} The built operation, signing context, and (in token mode) the paymaster quote.
   */
  async _buildUserOperation (calls, config) {
    const smartAccount = await this._getSmartAccount(config)
    const chainId = await this._getChainId()

    const mode = WalletAccountReadOnlyEvmErc4337._resolvePaymasterMode(config)
    const providerRpc = WalletAccountReadOnlyEvmErc4337._resolveProviderRpc(config.provider)
    const provider = mode !== PaymasterMode.NATIVE
      ? WalletAccountReadOnlyEvmErc4337._detectProvider(config.paymasterUrl)
      : null

    if (mode === PaymasterMode.NATIVE || provider === 'candide') {
      const gasPrice = await this._fetchBundlerGasPrice(config.bundlerUrl)
      const baseUserOp = await smartAccount.createUserOperation(
        calls,
        providerRpc,
        config.bundlerUrl,
        gasPrice
      )

      if (mode === PaymasterMode.NATIVE) {
        return { userOp: baseUserOp, smartAccount, mode, chainId }
      }

      const { userOp, tokenQuote } = await this._applyPaymasterToUserOp({
        mode, smartAccount, userOp: baseUserOp, config, chainId
      })
      return { userOp, smartAccount, mode, chainId, tokenQuote }
    }

    const gasPrice = await this._fetchBundlerGasPrice(config.bundlerUrl)
    const baseUserOp = await smartAccount.createUserOperation(
      calls,
      providerRpc,
      undefined,
      { skipGasEstimation: true, ...gasPrice }
    )

    const { userOp, tokenQuote } = await this._applyPaymasterToUserOp({
      mode, smartAccount, userOp: baseUserOp, config, chainId
    })

    return { userOp, smartAccount, mode, chainId, tokenQuote }
  }

  /**
   * Builds a UserOperation and returns its estimated gas cost.
   *
   * Returns the cost in the paymaster token when a token quote is available, otherwise in
   * native wei. Used by `quoteSendTransaction` and reused by `sendTransaction` via the cache.
   *
   * @protected
   * @param {EvmTransaction[]} txs - The EVM transactions to include in the UserOperation.
   * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The wallet configuration to use for the build.
   * @returns {Promise<BuiltUserOperation & { fee: bigint }>} The built operation plus its raw fee (no tolerance buffer applied).
   * @throws {Error} If the token paymaster reports AA50 (account does not hold the paymaster token).
   */
  async _getUserOperationGasCost (txs, config) {
    const calls = WalletAccountReadOnlyEvmErc4337._toMetaTransactions(txs)

    try {
      const buildResult = await this._buildUserOperation(calls, config)

      const fee = buildResult.tokenQuote
        ? buildResult.tokenQuote.tokenCost
        : calculateUserOperationMaxGasCost(buildResult.userOp)

      return { fee, ...buildResult }
    } catch (error) {
      if (error instanceof AbstractionKitError && error.message.includes('AA50')) {
        throw new Error(
          'Token paymaster requires the account to hold the paymaster token for fee estimation. ' +
          'Fund the account with the paymaster token before quoting.'
        )
      }
      throw error
    }
  }

  /** @private */
  static _resolvePaymasterMode (config) {
    if (config.useNativeCoins) return PaymasterMode.NATIVE
    if (config.isSponsored) return PaymasterMode.SPONSORED
    return PaymasterMode.TOKEN
  }

  /** @private */
  static _resolveProviderRpc (provider) {
    if (typeof provider === 'string') return provider
    if (Array.isArray(provider)) return provider.find(p => typeof p === 'string')
    throw new ConfigurationError('The provider must be a string URL or an array containing a string URL.')
  }

  /** @private */
  async _fetchBundlerGasPrice (bundlerUrl) {
    if (WalletAccountReadOnlyEvmErc4337._detectProvider(bundlerUrl) !== 'pimlico') return undefined

    const erc7677 = this._getPaymaster(bundlerUrl)
    const result = await erc7677.sendRPCRequest('pimlico_getUserOperationGasPrice', [])
    if (!result?.fast) return undefined

    return {
      maxFeePerGas: BigInt(result.fast.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(result.fast.maxPriorityFeePerGas)
    }
  }

  /** @private */
  static _detectProvider (url) {
    const detected = Erc7677Paymaster.detectProvider(url)
    if (detected) return detected
    if (url?.includes('pimlico')) return 'pimlico'
    if (url?.includes('candide')) return 'candide'
    return null
  }

  /** @private */
  async _applyPaymasterToUserOp ({ mode, smartAccount, userOp, config, chainId }) {
    const erc7677 = this._getPaymaster(config.paymasterUrl, { chainId: BigInt(chainId) })

    const context = mode === PaymasterMode.TOKEN
      ? { token: config.paymasterToken.address }
      : { sponsorshipPolicyId: config.sponsorshipPolicyId }

    const result = await erc7677.createPaymasterUserOperation(
      smartAccount,
      userOp,
      config.bundlerUrl,
      context,
      { entrypoint: ENTRYPOINT_V7 }
    )

    return { userOp: result.userOperation, tokenQuote: result.tokenQuote }
  }
}
