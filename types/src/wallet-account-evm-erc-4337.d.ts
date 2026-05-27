/** @implements {IWalletAccount} */
export default class WalletAccountEvmErc4337 extends WalletAccountReadOnlyEvmErc4337 implements IWalletAccount {
    /**
     * Creates a new evm [erc-4337](https://www.erc4337.io/docs) wallet account.
     *
     * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase.
     * @param {string} path - The BIP-44 derivation path (e.g. "0'/0/0").
     * @param {EvmErc4337WalletConfig} config - The configuration object.
     */
    constructor(seed: string | Uint8Array, path: string, config: EvmErc4337WalletConfig);
    /**
     * The evm erc-4337 wallet account configuration.
     *
     * @protected
     * @type {EvmErc4337WalletConfig}
     */
    protected _config: EvmErc4337WalletConfig;
    /** @private */
    private _ownerAccount;
    /** @private */
    private _quoteCache;
    /**
     * The derivation path's index of this account.
     *
     * @type {number}
     */
    get index(): number;
    /**
     * The derivation path of this account (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
     *
     * @type {string}
     */
    get path(): string;
    /**
     * The account's key pair.
     *
     * The uint8 arrays are bound to the wallet account, so any external change will reflect to the internal representation. For this reason,
     * it's strongly recommended to treat the key pair as a read-only view of the keys. While it's still technically possible to alter their
     * content, client code should never do so.
     *
     * @type {KeyPair}
     */
    get keyPair(): KeyPair;
    /**
     * Signs a message.
     *
     * @param {string} message - The message to sign.
     * @returns {Promise<string>} The message's signature.
     */
    sign(message: string): Promise<string>;
    /**
     * Signs typed data according to EIP-712.
     *
     * @param {TypedData} typedData - The typed data to sign.
     * @returns {Promise<string>} The typed data signature.
     */
    signTypedData({ domain, types, message }: TypedData): Promise<string>;
    /**
     * Signs a user operation built from the given transaction.
     *
     * @param {EvmErc4337Transaction} tx - The transaction to include in the user operation.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
     * @returns {Promise<UserOperationV7>} The signed user operation.
     */
    signTransaction(tx: EvmErc4337Transaction, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<UserOperationV7>;
    /**
     * Approves a specific amount of tokens to a spender.
     *
     * @param {ApproveOptions} options - The approve options.
     * @returns {Promise<TransactionResult>} - The transaction's result.
     * @throws {Error} - If trying to approve usdts on ethereum with allowance not equal to zero (due to the usdt allowance reset requirement).
     */
    approve(options: ApproveOptions): Promise<TransactionResult>;
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
    quoteSendTransaction(tx: EvmErc4337Transaction | EvmErc4337Transaction[], config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<Omit<TransactionResult, "hash">>;
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
    sendTransaction(tx: EvmErc4337Transaction | EvmErc4337Transaction[], config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<TransactionResult>;
    /**
     * Transfers a token to another address.
     *
     * @param {TransferOptions} options - The transfer's options.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
     * @returns {Promise<TransferResult>} The transfer's result.
     */
    transfer(options: TransferOptions, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<TransferResult>;
    /**
     * Returns a read-only copy of the account.
     *
     * @returns {Promise<WalletAccountReadOnlyEvmErc4337>} The read-only account.
     */
    toReadOnlyAccount(): Promise<WalletAccountReadOnlyEvmErc4337>;
    /**
     * Disposes the wallet account, erasing the private key from the memory.
     */
    dispose(): void;
    /** @private */
    private _bumpCachedNonces;
    /** @private */
    private static _getTxKey;
    /** @private */
    private _consumeCachedQuote;
    /** @private */
    private _signUserOperation;
    /** @private */
    private _sendUserOperation;
}
export type Eip1193Provider = import("ethers").Eip1193Provider;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type KeyPair = import("@tetherto/wdk-wallet-evm").KeyPair;
export type EvmErc4337Transaction = import("./wallet-account-read-only-evm-erc-4337.js").EvmErc4337Transaction;
export type TransactionResult = import("@tetherto/wdk-wallet-evm").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet-evm").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet-evm").TransferResult;
export type ApproveOptions = import("@tetherto/wdk-wallet-evm").ApproveOptions;
export type EvmErc4337WalletConfig = import("./wallet-account-read-only-evm-erc-4337.js").EvmErc4337WalletConfig;
export type EvmErc4337WalletPaymasterTokenConfig = import("./wallet-account-read-only-evm-erc-4337.js").EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import("./wallet-account-read-only-evm-erc-4337.js").EvmErc4337WalletSponsorshipPolicyConfig;
export type TypedData = import("./wallet-account-read-only-evm-erc-4337.js").TypedData;
export type EvmErc4337WalletNativeCoinsConfig = import("./wallet-account-read-only-evm-erc-4337.js").EvmErc4337WalletNativeCoinsConfig;
export type UserOperationV7 = import("abstractionkit").UserOperationV7;
export type SafeAccountV0_3_0 = import("abstractionkit").SafeAccountV0_3_0;
import WalletAccountReadOnlyEvmErc4337 from './wallet-account-read-only-evm-erc-4337.js';
