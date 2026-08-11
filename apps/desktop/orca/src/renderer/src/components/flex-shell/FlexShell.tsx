// Why: pure flexlayout-react shell for the pi terminal spike. Renders a
// persisted Model through the Layout component, mapping each tab's component
// id to a React node via an injected renderer registry. No terminals live here
// (identical to the model layer, this package owns only the shell chrome); the
// pi-chat content itself is provided by the caller through `renderers`.

import 'flexlayout-react/style/dark.css'
import { Layout, type Model, type TabNode } from 'flexlayout-react'

export type FlexShellProps = {
  model: Model
  renderers: Record<string, () => React.ReactNode>
  onModelChange?: (model: Model) => void
}

export function FlexShell(props: FlexShellProps): React.JSX.Element {
  const factory = (node: TabNode): React.ReactNode => {
    const componentId = node.getComponent() ?? ''
    const render = props.renderers[componentId]
    if (typeof render === 'function') {
      return render()
    }
    return <div data-testid="flex-shell-unknown-tab" />
  }

  return (
    <div className="relative h-full w-full" data-testid="flex-shell">
      <Layout
        model={props.model}
        factory={factory}
        onModelChange={props.onModelChange}
        realtimeResize
      />
    </div>
  )
}
