export const SALT_NONCE: "0x69b348339eea4ed93f9d11931c3b894c8f9d8c7663a053024b11cb7eb4e5a1f6";
export const FEE_TOLERANCE_COEFFICIENT: 120n;
export default class WalletAccountReadOnlyEvmErc4337 extends WalletAccountReadOnly {
    /**
     * Predicts the address of a safe account.
     *
     * @param {string} owner - The safe owner's address.
     * @param {Pick<EvmErc4337WalletConfig, 'safeModulesVersion' | 'onChainIdentifier'>} config - The safe configuration.
     * @returns {string} The Safe address.
     */
    static predictSafeAddress(owner: string, config: Pick<EvmErc4337WalletConfig, "safeModulesVersion" | "onChainIdentifier">): string;
    /**
     * Builds the init code overrides from the wallet configuration.
     *
     * @protected
     * @param {Pick<EvmErc4337WalletConfig, 'safeModulesVersion' | 'onChainIdentifier'>} config - The wallet configuration fields used for init code generation.
     * @returns {InitCodeOverrides} The init code overrides for SafeAccount creation.
     */
    protected static _getInitCodeOverrides(config: Pick<EvmErc4337WalletConfig, "safeModulesVersion" | "onChainIdentifier">): import('abstractionkit').InitCodeOverrides;
    /**
     * Creates a new read-only evm [erc-4337](https://www.erc4337.io/docs) wallet account.
     *
     * @param {string} address - The evm account's address.
     * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The configuration object.
     * @throws {ConfigurationError} If `config.safeModulesVersion` is not in the supported set.
     */
    constructor(address: string, config: Omit<EvmErc4337WalletConfig, "transferMaxFee">);
    /**
     * The read-only evm erc-4337 wallet account configuration.
     *
     * @protected
     * @type {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>}
     */
    protected _config: Omit<EvmErc4337WalletConfig, "transferMaxFee">;
    /**
     * Cached AbstractionKit bundler.
     *
     * @protected
     * @type {Bundler | undefined}
     */
    protected _bundler: Bundler | undefined;
    /**
     * The chain id.
     *
     * @protected
     * @type {bigint | undefined}
     */
    protected _chainId: bigint | undefined;
    /** @private */
    private _ownerAccountAddress;
    /**
     * Returns the account's eth balance.
     *
     * @returns {Promise<bigint>} The eth balance (in weis).
     */
    getBalance(): Promise<bigint>;
    /**
     * Returns the account balance for a specific token.
     *
     * @param {string} tokenAddress - The smart contract address of the token.
     * @returns {Promise<bigint>} The token balance (in base unit).
     */
    getTokenBalance(tokenAddress: string): Promise<bigint>;
    /**
     * Returns the account balances for multiple tokens.
     *
     * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
     * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
     */
    getTokenBalances(tokenAddresses: string[]): Promise<Record<string, bigint>>;
    /**
     * Returns the account's balance for the paymaster token provided in the wallet account configuration.
     *
     * @returns {Promise<bigint>} The paymaster token balance (in base unit).
     * @throws {ConfigurationError} If no paymaster token is configured (sponsored or native-coins mode).
     */
    getPaymasterTokenBalance(): Promise<bigint>;
    /**
     * Quotes the costs of a send transaction operation.
     *
     * The result is cached internally for up to 2 minutes. If `sendTransaction` is called with the
     * same transaction within that window, the cached fee is reused without an additional RPC round-trip.
     *
     * @param {EvmTransaction | EvmTransaction[]} tx - The transaction, or an array of multiple transactions to send in batch.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
     * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
     * @throws {ConfigurationError} If the override `config` is invalid or has missing required fields.
     * @throws {Error} If the token paymaster reports AA50 (account does not hold the paymaster token).
     */
    quoteSendTransaction(tx: EvmTransaction | EvmTransaction[], config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Quotes the costs of a transfer operation.
     *
     * The result is cached internally for up to 2 minutes. If `transfer` is called with the
     * same transaction within that window, the cached fee is reused without an additional RPC round-trip.
     *
     * @param {TransferOptions} options - The transfer's options.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If set, overrides the given configuration options.
     * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
     * @throws {ConfigurationError} If the override `config` is invalid or has missing required fields.
     * @throws {Error} If the token paymaster reports AA50 (account does not hold the paymaster token).
     */
    quoteTransfer(options: TransferOptions, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<Omit<TransferResult, "hash">>;
    /**
     * Returns a transaction's receipt.
     *
     * @param {string} hash - The user operation hash.
     * @returns {Promise<EvmTransactionReceipt | null>} – The receipt, or null if the transaction has not been included in a block yet.
     */
    getTransactionReceipt(hash: string): Promise<EvmTransactionReceipt | null>;
    /**
     * Returns a user operation's receipt.
     *
     * @param {string} hash - The user operation hash.
     * @returns {Promise<UserOperationReceipt | null>} – The receipt, or null if the user operation has not been included in a block yet.
     */
    getUserOperationReceipt(hash: string): Promise<UserOperationReceipt | null>;
    /**
     * Returns the current allowance for the given token and spender.
     *
     * @param {string} token - The token's address.
     * @param {string} spender - The spender's address.
     * @returns {Promise<bigint>} The allowance.
     */
    getAllowance(token: string, spender: string): Promise<bigint>;
    /**
     * Verifies a message's signature.
     *
     * @param {string} message - The original message.
     * @param {string} signature - The signature to verify.
     * @returns {Promise<boolean>} True if the signature is valid.
     */
    verify(message: string, signature: string): Promise<boolean>;
    /**
     * Verifies a typed data signature.
     *
     * @param {TypedData} typedData - The typed data to verify.
     * @param {string} signature - The signature to verify.
     * @returns {Promise<boolean>} True if the signature is valid.
     */
    verifyTypedData(typedData: TypedData, signature: string): Promise<boolean>;
    /**
     * Validates the configuration to ensure all required fields are present.
     *
     * @protected
     * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The configuration to validate.
     * @throws {ConfigurationError} If the configuration is invalid or has missing required fields.
     * @returns {void}
     */
    protected _validateConfig(config: Omit<EvmErc4337WalletConfig, "transferMaxFee">): void;
    /**
     * Builds a safe account instance for the current owner.
     *
     * @protected
     * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} [config] - The wallet configuration. Defaults to the instance configuration.
     * @returns {Promise<SafeAccountV0_3_0>} The safe account instance.
     */
    protected _getSmartAccount(config?: Omit<EvmErc4337WalletConfig, "transferMaxFee">): Promise<import('abstractionkit').SafeAccountV0_3_0>;
    /**
     * Returns an AbstractionKit Bundler for querying UserOperations.
     *
     * @protected
     * @returns {Bundler} The bundler.
     */
    protected _getBundler(): Bundler;
    /**
     * Returns the chain id.
     *
     * @protected
     * @returns {Promise<bigint>} - The chain id.
     */
    protected _getChainId(): Promise<bigint>;
    /** @private */
    private _getEvmReadOnlyAccount;
    /**
     * Builds a UserOperation with paymaster fields applied.
     *
     * @protected
     * @param {MetaTransaction[]} calls - The meta-transactions to include in the UserOperation.
     * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The wallet configuration.
     * @returns {Promise<BuiltUserOperation>} The built operation, signing context, and (in token mode) the paymaster quote.
     */
    protected _buildUserOperation(calls: import('abstractionkit').MetaTransaction[], config: Omit<EvmErc4337WalletConfig, "transferMaxFee">): Promise<BuiltUserOperation>;
    /**
     * Builds a UserOperation and returns its estimated gas cost.
     *
     * Returns the cost in the paymaster token when a token quote is available, otherwise in
     * native wei. Used by `quoteSendTransaction` and reused by `sendTransaction` via the cache.
     *
     * @protected
     * @param {EvmTransaction[]} txs - The EVM transactions to include in the UserOperation.
     * @param {Omit<EvmErc4337WalletConfig, 'transferMaxFee'>} config - The wallet configuration to use for the build.
     * @returns {Promise<BuiltUserOperation & Omit<TransactionResult, 'hash'>>} The built operation plus its raw fee (no tolerance buffer applied).
     * @throws {Error} If the token paymaster reports AA50 (account does not hold the paymaster token).
     */
    protected _getUserOperationGasCost(txs: EvmTransaction[], config: Omit<EvmErc4337WalletConfig, "transferMaxFee">): Promise<BuiltUserOperation & Omit<TransactionResult, "hash">>;
}
export type Eip1193Provider = import("ethers").Eip1193Provider;
export type EvmTransaction = import("@tetherto/wdk-wallet-evm").EvmTransaction;
export type TransactionResult = import("@tetherto/wdk-wallet-evm").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet-evm").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet-evm").TransferResult;
export type EvmTransactionReceipt = import("@tetherto/wdk-wallet-evm").EvmTransactionReceipt;
export type TypedData = import("@tetherto/wdk-wallet-evm").TypedData;
export type UserOperationReceipt = import('abstractionkit').UserOperationReceiptResult;
export type BuiltUserOperation = {
    /**
     * - The fully-populated UserOperation ready to sign.
     */
    userOp: import('abstractionkit').UserOperationV7;
    /**
     * - The Safe account that will execute the operation.
     */
    smartAccount: import('abstractionkit').SafeAccountV0_3_0;
    /**
     * - The paymaster mode used to build the operation.
     */
    mode: 'native' | 'sponsored' | 'token';
    /**
     * - The chain id captured at build time.
     */
    chainId: bigint;
    /**
     * - The paymaster token quote, present only in token mode.
     */
    tokenQuote?: import('abstractionkit').TokenQuote;
};
export type OnChainIdentifier = {
    /**
     * - The project name included in the 50-byte on-chain marker.
     */
    project: string;
    /**
     * - The platform type (default: 'Web').
     */
    platform?: "Web" | "Mobile" | "Safe App" | "Widget";
    /**
     * - The tool name used to create the UserOperation.
     */
    tool?: string;
    /**
     * - Semver-style tool version string included in the on-chain marker (e.g. "1.0.0").
     */
    toolVersion?: string;
};
export type EvmErc4337WalletCommonConfig = {
    /**
     * - The blockchain's id (e.g., 1 for ethereum).
     */
    chainId: number;
    /**
     * - The url of the rpc provider, or an instance of a class that implements eip-1193.
     */
    provider: string | Eip1193Provider;
    /**
     * - The url of the bundler service.
     */
    bundlerUrl: string;
    /**
     * - Version of the Safe 4337 module set to deploy with the account (e.g. "0.3.0"). Determines the module addresses used in init code.
     */
    safeModulesVersion: string;
    /**
     * - Optional on-chain identifier. Appends a 50-byte project marker to every UserOperation callData. Pass a string to reuse it as the project name, or a full object for more control.
     */
    onChainIdentifier?: OnChainIdentifier | string;
};
export type EvmErc4337WalletPaymasterTokenConfig = {
    /**
     * - Whether the paymaster is sponsoring the account.
     */
    isSponsored?: false;
    /**
     * - Whether to use native coins instead of a paymaster to pay for gas fees.
     */
    useNativeCoins?: false;
    /**
     * - The url of the paymaster service.
     */
    paymasterUrl: string;
    /**
     * - The address of the paymaster smart contract.
     */
    paymasterAddress: string;
    /**
     * - The paymaster token configuration.
     */
    paymasterToken: {
        address: string;
    };
    /**
     * - The maximum fee amount for transfer operations.
     */
    transferMaxFee?: number | bigint;
};
export type EvmErc4337WalletSponsorshipPolicyConfig = {
    /**
     * - Whether the paymaster is sponsoring the account.
     */
    isSponsored: true;
    /**
     * - Whether to use native coins instead of a paymaster to pay for gas fees.
     */
    useNativeCoins?: false;
    /**
     * - The url of the paymaster service.
     */
    paymasterUrl: string;
    /**
     * - Identifier of the paymaster sponsorship policy to apply (provider-specific). Optional; some paymasters infer the policy from the project key.
     */
    sponsorshipPolicyId?: string;
};
export type EvmErc4337WalletNativeCoinsConfig = {
    /**
     * - Whether the paymaster is sponsoring the account.
     */
    isSponsored?: false;
    /**
     * - Whether to use native coins instead of a paymaster to pay for gas fees.
     */
    useNativeCoins: true;
    /**
     * - The maximum fee amount for transfer operations.
     */
    transferMaxFee?: number | bigint;
};
export type EvmErc4337WalletConfig = EvmErc4337WalletCommonConfig & (EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig);
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet';
import { Bundler } from 'abstractionkit';
