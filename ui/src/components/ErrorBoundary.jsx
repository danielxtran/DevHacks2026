import { Component } from 'react'
import { Button, StateView } from './ui'

export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <StateView kind="error" title="This view hit an error" action={<Button onClick={() => this.setState({ error: null })}>↻ Try again</Button>}>
        {String(this.state.error.message || this.state.error)}. If it keeps happening, choose “Reset demo data” in the Demo menu (top right).
      </StateView>
    )
  }
}
