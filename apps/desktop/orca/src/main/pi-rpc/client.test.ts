import { describe, expect, it } from 'vitest'
import { buildPiRpcArgs, PI_RPC_CLI_PATH, PI_RPC_MODEL_ENV, PI_RPC_PROVIDER_ENV } from './client'

describe('buildPiRpcArgs', () => {
  it('omits provider and model when nothing is configured', () => {
    expect(buildPiRpcArgs({}, {})).toEqual([PI_RPC_CLI_PATH, '--mode', 'rpc'])
  })

  it('takes provider and model from the environment', () => {
    expect(
      buildPiRpcArgs({}, { [PI_RPC_PROVIDER_ENV]: 'acme', [PI_RPC_MODEL_ENV]: 'acme/fast' })
    ).toEqual([PI_RPC_CLI_PATH, '--mode', 'rpc', '--provider', 'acme', '--model', 'acme/fast'])
  })

  it('lets explicit options win over the environment', () => {
    expect(
      buildPiRpcArgs(
        { provider: 'chosen', model: 'chosen/one' },
        { [PI_RPC_PROVIDER_ENV]: 'acme', [PI_RPC_MODEL_ENV]: 'acme/fast' }
      )
    ).toEqual([PI_RPC_CLI_PATH, '--mode', 'rpc', '--provider', 'chosen', '--model', 'chosen/one'])
  })

  it('passes each flag independently', () => {
    expect(buildPiRpcArgs({ provider: 'acme' }, {})).toEqual([
      PI_RPC_CLI_PATH,
      '--mode',
      'rpc',
      '--provider',
      'acme'
    ])
    expect(buildPiRpcArgs({ model: 'acme/fast' }, {})).toEqual([
      PI_RPC_CLI_PATH,
      '--mode',
      'rpc',
      '--model',
      'acme/fast'
    ])
  })

  it('treats an empty env value as unset, so a blank var cannot break the spawn', () => {
    expect(buildPiRpcArgs({}, { [PI_RPC_PROVIDER_ENV]: '', [PI_RPC_MODEL_ENV]: '' })).toEqual([
      PI_RPC_CLI_PATH,
      '--mode',
      'rpc'
    ])
  })
})
