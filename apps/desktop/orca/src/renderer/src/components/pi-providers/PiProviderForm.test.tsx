// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiProviderForm } from './PiProviderForm'

const writeProviderMock = vi.hoisted(() => vi.fn())
const listProvidersMock = vi.hoisted(() => vi.fn())
const rpcSendMock = vi.hoisted(() => vi.fn())

function installApiMock(): void {
  listProvidersMock.mockResolvedValue({ providers: [] })
  ;(window as never as { api: unknown }).api = {
    piExtensions: { writeProvider: writeProviderMock, listProviders: listProvidersMock },
    piRpc: { send: rpcSendMock }
  } as never
}

afterEach(() => {
  cleanup()
  writeProviderMock.mockReset()
  listProvidersMock.mockReset()
  rpcSendMock.mockReset()
})

describe('PiProviderForm', () => {
  it('refuses and explains a raw-looking credential before saving', () => {
    installApiMock()
    render(<PiProviderForm />)

    fireEvent.change(screen.getByLabelText(/Credential/i), {
      target: { value: 'sk-12345678901234567890123456789012' }
    })
    fireEvent.change(screen.getByLabelText(/Provider id/i), {
      target: { value: 'acme' }
    })
    fireEvent.change(screen.getByLabelText(/Display name/i), {
      target: { value: 'Acme AI' }
    })
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: 'https://api.acme.example/v1' }
    })

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    expect(
      screen.getByText(/That looks like a raw API key — the key goes in an environment variable/i)
    ).toBeTruthy()
    // The main writer must never be reached with a raw key.
    expect(writeProviderMock).not.toHaveBeenCalled()
  })

  it('shows the persistent env-var 401 pitfall hint', () => {
    installApiMock()
    render(<PiProviderForm />)
    expect(screen.getByText(/if that environment variable does not exist/i)).toBeTruthy()
    expect(screen.getByText(/401/i)).toBeTruthy()
  })

  it('lists the providers currently registered in models.json', async () => {
    installApiMock()
    listProvidersMock.mockResolvedValue({
      providers: [
        { id: 'acme', name: 'Acme AI', modelCount: 2 },
        { id: 'beta', name: 'Beta', modelCount: 1 }
      ]
    })
    render(<PiProviderForm />)

    expect(await screen.findByTestId('pi-registered-provider-acme')).toBeTruthy()
    expect(screen.getByTestId('pi-registered-provider-beta')).toBeTruthy()
    expect(screen.getByText('Acme AI')).toBeTruthy()
    expect(screen.getByText('2 models')).toBeTruthy()
    expect(screen.getByText('1 model')).toBeTruthy()
  })

  it('saves a valid provider with an env-var credential and shows the new-session notice', async () => {
    installApiMock()
    writeProviderMock.mockResolvedValue({ ok: true, path: 'C:/fake/models.json' })
    render(<PiProviderForm />)

    fireEvent.change(screen.getByLabelText(/Provider id/i), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText(/Display name/i), { target: { value: 'Acme AI' } })
    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: 'https://api.acme.example/v1' }
    })
    fireEvent.change(screen.getByLabelText(/Credential/i), {
      target: { value: 'ACME_API_KEY' }
    })
    fireEvent.change(screen.getByLabelText(/Model id/i), { target: { value: 'acme/m1' } })
    fireEvent.change(screen.getByLabelText(/Model name/i), { target: { value: 'M1' } })
    fireEvent.change(screen.getByLabelText(/Context window/i), { target: { value: '128000' } })
    fireEvent.change(screen.getByLabelText(/Max tokens/i), { target: { value: '8192' } })

    fireEvent.click(screen.getByRole('button', { name: /Save provider/i }))

    expect(writeProviderMock).toHaveBeenCalledTimes(1)
    const spec = writeProviderMock.mock.calls[0][0]
    expect(spec).toMatchObject({
      providerId: 'acme',
      providerName: 'Acme AI',
      baseUrl: 'https://api.acme.example/v1',
      credential: 'ACME_API_KEY',
      api: 'openai-completions'
    })
    expect(spec.models).toHaveLength(1)
    expect(spec.models[0]).toMatchObject({
      id: 'acme/m1',
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false
    })

    // The "start new session" button should be offered after a successful save.
    expect(await screen.findByText(/Provider saved/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Start new session/i }))
    expect(rpcSendMock).toHaveBeenCalledWith({ type: 'new_session' })
  })
})
