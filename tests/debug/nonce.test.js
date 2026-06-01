import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { ethers } from 'ethers'
import { alto } from 'prool/instances'
import { paymaster } from '@pimlico/mock-paymaster'
import path from 'path'

import WalletManagerEvmErc4337 from '../../index.js'
import { MOCK_PAYMASTER_TOKEN_ADDRESS } from '../helpers/mock-paymaster-token.js'
import { discoverPaymasterAddress } from '../helpers/erc-7677-discovery.js'

const TIMEOUT = 60_000
const ENTRY_POINT_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'
const RPC_URL = 'http://localhost:8545'
const BUNDLER_PORT = 4338
const PAYMASTER_PORT = 3001
const BUNDLER_URL = `http://localhost:${BUNDLER_PORT}`
const PAYMASTER_URL = `http://localhost:${PAYMASTER_PORT}?pimlico`
const PAYMASTER_DISCOVERY_URL = `http://localhost:${PAYMASTER_PORT}`
const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const NONCE_SEQUENCE_MASK = (1n << 64n) - 1n

const ethersProvider = new ethers.JsonRpcProvider(RPC_URL)
const fundingWallet = new ethers.Wallet(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  ethersProvider
)

function resolveAltoCli () {
  return path.resolve(process.cwd(), 'node_modules', '@pimlico', 'alto', 'esm', 'cli', 'alto.js')
}

async function setupServers () {
  const bundlerInstance = alto({
    port: BUNDLER_PORT,
    entrypoints: [ENTRY_POINT_ADDRESS],
    rpcUrl: RPC_URL,
    logLevel: 'debug',
    'executor-private-keys': [fundingWallet.privateKey],
    'utility-private-key': [fundingWallet.privateKey],
    safeMode: false,
    pollingInterval: 0,
    binary: resolveAltoCli()
  })
  await bundlerInstance.start()

  const paymasterInstance = paymaster({
    port: PAYMASTER_PORT,
    anvilRpc: RPC_URL,
    altoRpc: BUNDLER_URL
  })
  await paymasterInstance.start()

  return { bundlerInstance, paymasterInstance }
}

async function waitForTx (txHash, account) {
  for (let i = 0; i < 60; i++) {
    try {
      const receipt = await account.getTransactionReceipt(txHash)
      if (receipt) return receipt
    } catch {
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`Transaction not mined after 60 seconds: ${txHash}`)
}

async function sendAndWait (account, tx, config) {
  const result = await account.sendTransaction(tx, config)
  const receipt = await waitForTx(result.hash, account)
  expect(receipt.status).toBe(1)
  return result
}

async function mintPaymasterTokens (to) {
  const token = new ethers.Contract(
    MOCK_PAYMASTER_TOKEN_ADDRESS,
    ['function sudoMint(address to, uint256 amount)'],
    fundingWallet
  )
  const tx = await token.sudoMint(to, ethers.parseEther('10000'), { gasLimit: 100000 })
  await tx.wait()
}

async function fundSafe (address, { withPaymasterTokens = true } = {}) {
  const tx = await fundingWallet.sendTransaction({
    to: address,
    value: ethers.parseEther('5')
  })
  await tx.wait()

  if (withPaymasterTokens) {
    await mintPaymasterTokens(address)
  }
}

function nonceSequence (nonce) {
  return nonce & NONCE_SEQUENCE_MASK
}

function cachedNonce (account, tx) {
  return account._quoteCache.get(account.constructor._getTxKey(tx)).userOp.nonce
}

describe('cached quote nonce failure-scenario test bed', () => {
  let wallet
  let config
  let bundlerInstance
  let paymasterInstance
  let nextAccountIndex = 20
  let account

  beforeAll(async () => {
    const servers = await setupServers()
    bundlerInstance = servers.bundlerInstance
    paymasterInstance = servers.paymasterInstance

    const paymasterAddress = await discoverPaymasterAddress(
      PAYMASTER_DISCOVERY_URL,
      ENTRY_POINT_ADDRESS,
      MOCK_PAYMASTER_TOKEN_ADDRESS
    )

    config = {
      chainId: 1,
      provider: RPC_URL,
      bundlerUrl: BUNDLER_URL,
      paymasterUrl: PAYMASTER_URL,
      paymasterAddress,
      safeModulesVersion: '0.3.0',
      paymasterToken: {
        address: MOCK_PAYMASTER_TOKEN_ADDRESS
      }
    }

    wallet = new WalletManagerEvmErc4337(SEED_PHRASE, config)
  }, TIMEOUT)

  afterAll(async () => {
    await bundlerInstance?.stop()
    await paymasterInstance?.stop()
  }, TIMEOUT)

  async function fundedAccount (options) {
    const account = await wallet.getAccountByPath(`0'/0/${nextAccountIndex++}`)
    await fundSafe(await account.getAddress(), options)
    account._quoteCache.clear()
    account._nextNonce = undefined
    return account
  }

  beforeEach(async () => {
    account = await fundedAccount()
  }, TIMEOUT)

  test('1a: quote then immediate send same tx uses the cached quote', async () => {
    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')
    const tx = { to: await account.getAddress(), value: 0 }

    const { fee: quotedFee } = await account.quoteSendTransaction(tx)
    const { fee: sentFee } = await sendAndWait(account, tx)

    expect(sentFee).toBe(quotedFee)
    expect(quoteSpy).toHaveBeenCalledTimes(1)
    quoteSpy.mockRestore()
  }, TIMEOUT)

  test('1b: send with no prior quote follows the fresh-build path', async () => {
    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')
    const tx = { to: await account.getAddress(), value: 0 }

    await sendAndWait(account, tx)

    expect(quoteSpy).toHaveBeenCalledTimes(1)
    quoteSpy.mockRestore()
  }, TIMEOUT)

  test('1c: expired cached quote is ignored and re-quoted fresh', async () => {
    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')
    const tx = { to: await account.getAddress(), value: 0 }

    await account.quoteSendTransaction(tx)
    const txKey = account._quoteCache.keys().next().value
    account._quoteCache.get(txKey).createdAt = Date.now() - 3 * 60 * 1_000

    await sendAndWait(account, tx)

    expect(quoteSpy).toHaveBeenCalledTimes(2)
    quoteSpy.mockRestore()
  }, TIMEOUT)

  test('2a: quote A, quote B, send A mined, then send B rebinds B to the advanced nonce', async () => {
    const rebindSpy = jest.spyOn(account, '_rebindCachedQuoteNonce')
    const txA = { to: await account.getAddress(), value: 0 }
    const txB = { to: await account.getAddress(), value: 1 }

    await account.quoteSendTransaction(txA)
    await account.quoteSendTransaction(txB)

    await sendAndWait(account, txA)
    await sendAndWait(account, txB)

    expect(rebindSpy).toHaveBeenCalled()
    rebindSpy.mockRestore()
  }, TIMEOUT)

  test('2b: quote A, quote B, send B first, then send A succeeds out of order', async () => {
    const txA = { to: await account.getAddress(), value: 0 }
    const txB = { to: await account.getAddress(), value: 1 }

    const { fee: feeA } = await account.quoteSendTransaction(txA)
    const { fee: feeB } = await account.quoteSendTransaction(txB)

    const sentB = await sendAndWait(account, txB)
    const sentA = await sendAndWait(account, txA)

    expect(sentB.fee).toBe(feeB)
    expect(sentA.fee).toBeGreaterThan(0n)
    expect(feeA).toBeGreaterThan(0n)
  }, TIMEOUT)

  test('2c: quote A, quote B, send A, then immediately send B while A is pending', async () => {
    const txA = { to: await account.getAddress(), value: 0 }
    const txB = { to: await account.getAddress(), value: 1 }

    await account.quoteSendTransaction(txA)
    await account.quoteSendTransaction(txB)

    const resultA = await account.sendTransaction(txA)
    const resultB = await account.sendTransaction(txB)

    const [receiptA, receiptB] = await Promise.all([
      waitForTx(resultA.hash, account),
      waitForTx(resultB.hash, account)
    ])

    expect(receiptA.status).toBe(1)
    expect(receiptB.status).toBe(1)
    expect(resultA.hash).not.toBe(resultB.hash)
  }, TIMEOUT)

  test('2d: Promise.all sends two different transactions with serialized local nonce allocation', async () => {
    const txA = { to: await account.getAddress(), value: 0 }
    const txB = { to: await account.getAddress(), value: 1 }

    const [resultA, resultB] = await Promise.all([
      account.sendTransaction(txA),
      account.sendTransaction(txB)
    ])

    const [receiptA, receiptB] = await Promise.all([
      waitForTx(resultA.hash, account),
      waitForTx(resultB.hash, account)
    ])

    expect(receiptA.status).toBe(1)
    expect(receiptB.status).toBe(1)
    expect(resultA.hash).not.toBe(resultB.hash)
  }, TIMEOUT)

  test('2e: Promise.all sends the same quoted tx once from cache and once from a fresh quote', async () => {
    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')
    const tx = { to: await account.getAddress(), value: 0 }

    await account.quoteSendTransaction(tx)

    const [resultA, resultB] = await Promise.all([
      account.sendTransaction(tx),
      account.sendTransaction(tx)
    ])

    const [receiptA, receiptB] = await Promise.all([
      waitForTx(resultA.hash, account),
      waitForTx(resultB.hash, account)
    ])

    expect(receiptA.status).toBe(1)
    expect(receiptB.status).toBe(1)
    expect(resultA.hash).not.toBe(resultB.hash)
    expect(quoteSpy).toHaveBeenCalledTimes(2)
    quoteSpy.mockRestore()
  }, TIMEOUT)

  test('3a: an external mined op advances the nonce before our cached send allocates', async () => {
    const externalWallet = new WalletManagerEvmErc4337(SEED_PHRASE, config)
    const externalAccount = await externalWallet.getAccountByPath(account.path.replace("m/44'/60'/", ''))
    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')
    const rebindSpy = jest.spyOn(account, '_rebindCachedQuoteNonce')
    const safeAddress = await account.getAddress()
    const txA = { to: await account.getAddress(), value: 0 }
    const txExternal = { to: await account.getAddress(), value: 1 }

    expect(await externalAccount.getAddress()).toBe(safeAddress)

    const nonceBefore = account._nextNonce
    const { fee: quotedFee } = await account.quoteSendTransaction(txA)
    expect(quoteSpy).toHaveBeenCalledTimes(1)

    const externalResult = await sendAndWait(externalAccount, txExternal)
    expect(externalResult.hash).toEqual(expect.any(String))

    const { hash, fee } = await sendAndWait(account, txA)

    expect(hash).not.toBe(externalResult.hash)
    expect(fee).toBeGreaterThan(0n)
    expect(quotedFee).toBeGreaterThan(0n)
    expect(nonceSequence(account._nextNonce)).toBe(nonceBefore === undefined ? 1n : nonceSequence(nonceBefore) + 1n)
    expect(account._nextNonce).not.toBe(externalAccount._nextNonce)
    expect(quoteSpy).toHaveBeenCalledTimes(1)
    expect(rebindSpy).toHaveBeenCalledTimes(1)

    quoteSpy.mockRestore()
    rebindSpy.mockRestore()
  }, TIMEOUT)

  test('3c: external real send does not collide with our cached send because it uses a parallel nonce key', async () => {
    const externalWallet = new WalletManagerEvmErc4337(SEED_PHRASE, config)
    const externalAccount = await externalWallet.getAccountByPath(account.path.replace("m/44'/60'/", ''))
    const address = await account.getAddress()
    const txA = { to: address, value: 0 }
    const txExternal = { to: address, value: 1 }

    expect(await externalAccount.getAddress()).toBe(address)

    await sendAndWait(account, txA)
    account._quoteCache.clear()
    account._nextNonce = undefined

    const quoteSpy = jest.spyOn(account, 'quoteSendTransaction')

    await account.quoteSendTransaction(txA)
    const cachedLocalNonce = cachedNonce(account, txA)

    const externalResult = await sendAndWait(externalAccount, txExternal)
    const localResult = await sendAndWait(account, txA)

    expect(localResult.hash).toEqual(expect.any(String))
    expect(externalResult.hash).toEqual(expect.any(String))
    expect(localResult.hash).not.toBe(externalResult.hash)
    expect(localResult.fee).toBeGreaterThan(0n)
    expect(externalResult.fee).toBeGreaterThan(0n)
    expect(nonceSequence(cachedLocalNonce)).toBe(0n)
    expect(nonceSequence(account._nextNonce)).toBe(1n)
    expect(nonceSequence(externalAccount._nextNonce)).toBe(1n)
    expect(account._nextNonce).not.toBe(externalAccount._nextNonce)
    expect(quoteSpy).toHaveBeenCalledTimes(1)

    quoteSpy.mockRestore()
  }, TIMEOUT)

  test('3d: two WDK instances on the same account send real txs with independent nonce keys', async () => {
    const secondWallet = new WalletManagerEvmErc4337(SEED_PHRASE, config)
    const secondAccount = await secondWallet.getAccountByPath(account.path.replace("m/44'/60'/", ''))
    const address = await account.getAddress()
    const txA = { to: address, value: 0 }
    const txB = { to: address, value: 1 }

    expect(await secondAccount.getAddress()).toBe(address)

    await sendAndWait(account, txA)
    account._quoteCache.clear()
    account._nextNonce = undefined

    await account.quoteSendTransaction(txA)
    await secondAccount.quoteSendTransaction(txB)
    const firstQuotedNonce = cachedNonce(account, txA)
    const secondQuotedNonce = cachedNonce(secondAccount, txB)

    const [firstResult, secondResult] = await Promise.all([
      account.sendTransaction(txA),
      secondAccount.sendTransaction(txB)
    ])

    const [firstReceipt, secondReceipt] = await Promise.all([
      waitForTx(firstResult.hash, account),
      waitForTx(secondResult.hash, secondAccount)
    ])

    expect(firstReceipt.status).toBe(1)
    expect(secondReceipt.status).toBe(1)
    expect(firstResult.hash).toEqual(expect.any(String))
    expect(secondResult.hash).toEqual(expect.any(String))
    expect(firstResult.hash).not.toBe(secondResult.hash)
    expect(firstResult.fee).toBeGreaterThan(0n)
    expect(secondResult.fee).toBeGreaterThan(0n)
    expect(nonceSequence(firstQuotedNonce)).toBe(0n)
    expect(nonceSequence(secondQuotedNonce)).toBe(0n)
    expect(firstQuotedNonce).not.toBe(secondQuotedNonce)
    expect(account._nextNonce).toBe(firstQuotedNonce + 1n)
    expect(secondAccount._nextNonce).toBe(secondQuotedNonce + 1n)
  }, TIMEOUT)

  test('4b: sponsored quote followed by token send builds the final op with token-mode config', async () => {
    const buildSpy = jest.spyOn(account, '_buildAtNonce')
    const tx = { to: await account.getAddress(), value: 0 }
    const sponsoredConfig = {
      isSponsored: true,
      paymasterUrl: PAYMASTER_URL
    }

    await account.quoteSendTransaction(tx, sponsoredConfig)
    await sendAndWait(account, tx)

    expect(buildSpy).toHaveBeenCalled()
    expect(buildSpy.mock.calls.at(-1)[3].isSponsored).toBeUndefined()
    expect(buildSpy.mock.calls.at(-1)[3].paymasterToken).toEqual({
      address: MOCK_PAYMASTER_TOKEN_ADDRESS
    })
    buildSpy.mockRestore()
  }, TIMEOUT)

  test('5a: first send on a fresh undeployed account deploys the Safe', async () => {
    const address = await account.getAddress()
    const tx = { to: address, value: 0 }

    const codeBefore = await ethersProvider.getCode(address)
    await sendAndWait(account, tx)
    const codeAfter = await ethersProvider.getCode(address)

    expect(codeBefore).toBe('0x')
    expect(codeAfter).not.toBe('0x')
  }, TIMEOUT)

  test('5b: quote while undeployed, deploy with another tx, then cached send strips stale deploy fields', async () => {
    const rebindSpy = jest.spyOn(account, '_rebindCachedQuoteNonce')
    const address = await account.getAddress()
    const txA = { to: address, value: 0 }
    const txDeploying = { to: address, value: 1 }

    await account.quoteSendTransaction(txA)
    await sendAndWait(account, txDeploying)
    await sendAndWait(account, txA)

    expect(rebindSpy).toHaveBeenCalled()
    const reboundQuote = rebindSpy.mock.results.at(-1).value
    await expect(reboundQuote).resolves.toMatchObject({
      userOp: {
        factory: null,
        factoryData: null
      }
    })
    rebindSpy.mockRestore()
  }, TIMEOUT)

  test('6a: RPC failure during nonce read throws before submit', async () => {
    const tx = { to: await account.getAddress(), value: 0 }
    const submitSpy = jest.spyOn(account, '_sendUserOperation')

    await account.quoteSendTransaction(tx)
    account._provider = {}

    await expect(account.sendTransaction(tx)).rejects.toThrow()
    expect(submitSpy).not.toHaveBeenCalled()
    submitSpy.mockRestore()
  }, TIMEOUT)

  test('6b: transport failure after allocation is not retried because acceptance is ambiguous', async () => {
    const tx = { to: await account.getAddress(), value: 0 }
    const submitSpy = jest
      .spyOn(account, '_sendUserOperation')
      .mockRejectedValue(new Error('socket hang up'))

    await account.quoteSendTransaction(tx)

    await expect(account.sendTransaction(tx)).rejects.toThrow('socket hang up')
    expect(submitSpy).toHaveBeenCalledTimes(1)
    submitSpy.mockRestore()
  }, TIMEOUT)

  test('6d: pre-acceptance paymaster funds rejection re-syncs the local nonce tracker', async () => {
    const tx = { to: await account.getAddress(), value: 0 }
    const submitSpy = jest
      .spyOn(account, '_sendUserOperation')
      .mockRejectedValue(new Error('Not enough funds on the safe account to repay the paymaster.'))

    await account.quoteSendTransaction(tx)

    await expect(account.sendTransaction(tx)).rejects.toThrow('Not enough funds')
    expect(account._nextNonce).toBe(undefined)
    submitSpy.mockRestore()
  }, TIMEOUT)

  test.todo('3b: external op pending-unmined with the same key fails safely until the external op mines')
  test.todo('5c: if rebind misses stale factory fields, AA10 retry backstop rebuilds fresh')
  test.todo('5d: deployed but key-0 nonce 0 is covered by the AA10 retry backstop')
  test.todo('6c: op accepted and later evicted has the same bounded drift behavior as transport ambiguity')
  test.todo('7a: restart mid-flight loses the in-memory local mark and relies on retry once the pending op mines')

  test.skip('4a: quote token A then send token B documents the pre-existing config-insensitive cache key residual', () => {})
  test.skip('4c: quote token then send sponsored documents the same config-insensitive cache key residual', () => {})
})
