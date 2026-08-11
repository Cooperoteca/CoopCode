// @vitest-environment happy-dom

import type * as ReactNamespace from 'react'

// Why: exercise the picker's protocol flow (get_state on mount, lazy
// get_available_models on open, set_model on select) against a fake preload
// surface and radix primitives, so the component logic is covered without an
// electron/pi runtime. The real dropdown-menu/button/i18n are mocked; the
// public behaviour (which commands are sent, what the trigger shows) is real.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiRpcApi } from '../../../../preload/api-types'
import { PiChatModelPicker } from './PiChatModelPicker'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) => {
    if (!values) {
      return fallback
    }
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      fallback
    )
  }
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  )
}))

// Minimal stand-in for the radix dropdown: keeps open state in a module ref and
// wires the trigger to toggle it, mirroring how the real primitive controls
// content mount + click-to-open.
vi.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react') as typeof ReactNamespace
  const openRef = { current: false }
  let setter: ((open: boolean) => void) | undefined

  return {
    DropdownMenu: ({
      open,
      onOpenChange,
      children
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      children?: ReactNode
    }) => {
      openRef.current = open ?? false
      setter = onOpenChange
      return React.createElement(
        'div',
        { 'data-testid': 'pi-model-menu-root', 'data-open': openRef.current ? '1' : '0' },
        children
      )
    },
    DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => {
      // asChild: children is the Button elt; clone it to attach click + testid.
      const click = () => setter?.(!openRef.current)
      if (React.isValidElement(children)) {
        return React.cloneElement(
          children,
          {
            onClick: click,
            'data-testid': 'pi-model-picker-trigger'
          } as Record<string, unknown>
        )
      }
      return React.createElement(
        'button',
        { 'data-testid': 'pi-model-picker-trigger', onClick: click },
        children
      )
    },
    DropdownMenuContent: ({
      children,
      ...rest
    }: {
      children?: ReactNode
      'data-testid'?: string
    }) =>
      openRef.current
        ? React.createElement('div', { ...rest, 'data-testid': 'pi-model-picker-menu' }, children)
        : null,
    DropdownMenuGroup: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    DropdownMenuLabel: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) =>
      React.createElement('button', { ...rest, disabled, onClick: () => onSelect?.() }, children)
  }
})

type Frame = { kind: 'frame'; payload: Record<string, unknown> }

function makeFakePiRpc(): {
  api: PiRpcApi
  sent: Record<string, unknown>[]
  emit: (payload: Record<string, unknown>) => void
} {
  const listeners = new Set<(frame: Frame) => void>()
  const sent: Record<string, unknown>[] = []
  const api = {
    start: vi.fn(async () => undefined),
    send: vi.fn(async (command: Record<string, unknown>) => {
      sent.push(command)
    }),
    dispose: vi.fn(async () => undefined),
    onFrame: vi.fn((callback: (frame: Frame) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    })
  } as unknown as PiRpcApi
  return {
    api,
    sent,
    emit: (payload) => {
      for (const listener of listeners) {
        listener({ kind: 'frame', payload })
      }
    }
  }
}

function emitGetState(fixture: ReturnType<typeof makeFakePiRpc>): void {
  const id = String(fixture.sent[0].id)
  fixture.emit({
    type: 'response',
    id,
    command: 'get_state',
    success: true,
    data: { model: { id: 'current', provider: 'anthropic' } }
  })
}

describe('PiChatModelPicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('requests get_state on mount and shows the current provider/model', async () => {
    const fixture = makeFakePiRpc()
    render(<PiChatModelPicker api={fixture.api} />)

    expect(fixture.sent[0]?.type).toBe('get_state')

    emitGetState(fixture)
    await waitFor(() => {
      expect(screen.getByTestId('pi-model-picker-trigger').textContent).toContain(
        'anthropic/current'
      )
    })
  })

  it('shows the no-model placeholder when get_state returns no model', async () => {
    const fixture = makeFakePiRpc()
    render(<PiChatModelPicker api={fixture.api} />)
    const id = String(fixture.sent[0].id)
    fixture.emit({ type: 'response', id, command: 'get_state', success: true, data: {} })
    await waitFor(() => {
      expect(screen.getByTestId('pi-model-picker-trigger').textContent).toContain('No model')
    })
  })

  it('fetches available models on open and groups them by provider', async () => {
    const fixture = makeFakePiRpc()
    render(<PiChatModelPicker api={fixture.api} />)
    emitGetState(fixture)

    fireEvent.click(screen.getByTestId('pi-model-picker-trigger'))
    const modelsCommand = fixture.sent.at(-1)
    expect(modelsCommand.type).toBe('get_available_models')

    const modelsId = String(modelsCommand.id)
    fixture.emit({
      type: 'response',
      id: modelsId,
      command: 'get_available_models',
      success: true,
      data: {
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
          { id: 'claude-sonnet-4-5', provider: 'anthropic' }
        ]
      }
    })

    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeTruthy()
      expect(screen.getByText('claude-sonnet-4-5')).toBeTruthy()
    })
  })

  it('sends set_model on selection and updates the header from the response', async () => {
    const fixture = makeFakePiRpc()
    render(<PiChatModelPicker api={fixture.api} />)
    emitGetState(fixture)

    fireEvent.click(screen.getByTestId('pi-model-picker-trigger'))
    const modelsCommand = fixture.sent.at(-1)
    fixture.emit({
      type: 'response',
      id: String(modelsCommand.id),
      command: 'get_available_models',
      success: true,
      data: { models: [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }] }
    })

    const option = await screen.findByText('GPT-4o')
    fireEvent.click(option)

    const setModel = fixture.sent.at(-1)
    expect(setModel.type).toBe('set_model')
    expect(setModel.provider).toBe('openai')
    expect(setModel.modelId).toBe('gpt-4o')

    fixture.emit({
      type: 'response',
      id: String(setModel.id),
      command: 'set_model',
      success: true,
      data: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
    })

    await waitFor(() => {
      expect(screen.getByTestId('pi-model-picker-trigger').textContent).toContain('openai/gpt-4o')
    })
  })

  it('caches available models across repeated opens', async () => {
    const fixture = makeFakePiRpc()
    render(<PiChatModelPicker api={fixture.api} />)
    emitGetState(fixture)

    fireEvent.click(screen.getByTestId('pi-model-picker-trigger'))
    const modelsCommand = fixture.sent.at(-1)
    fixture.emit({
      type: 'response',
      id: String(modelsCommand.id),
      command: 'get_available_models',
      success: true,
      data: { models: [{ id: 'gpt-4o', provider: 'openai' }] }
    })
    await screen.findByText('gpt-4o')

    expect(fixture.sent.filter((c) => c.type === 'get_available_models')).toHaveLength(1)

    // Close, then reopen: hits the cache, so still only one fetch.
    fireEvent.click(screen.getByTestId('pi-model-picker-trigger'))
    fireEvent.click(screen.getByTestId('pi-model-picker-trigger'))

    expect(fixture.sent.filter((c) => c.type === 'get_available_models')).toHaveLength(1)
  })
})
