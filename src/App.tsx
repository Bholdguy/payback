import { useEffect, useState } from 'react'
import { init } from '@nimiq/mini-app-sdk'

type CheckStatus = 'pending' | 'ok' | 'error'

interface Checks {
  init: CheckStatus
  listAccounts: CheckStatus
  isConsensusEstablished: CheckStatus
}

function App() {
  const [checks, setChecks] = useState<Checks>({
    init: 'pending',
    listAccounts: 'pending',
    isConsensusEstablished: 'pending',
  })
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    const append = (line: string) => setLog((prev) => [...prev, line])

    init({ timeout: 10_000 })
      .then((provider) => {
        setChecks((c) => ({ ...c, init: 'ok' }))
        append('init() resolved')

        provider
          .listAccounts()
          .then((result) => {
            setChecks((c) => ({ ...c, listAccounts: 'ok' }))
            append(`listAccounts() resolved: ${JSON.stringify(result)}`)
          })
          .catch((err) => {
            setChecks((c) => ({ ...c, listAccounts: 'error' }))
            append(`listAccounts() rejected: ${String(err)}`)
          })

        provider
          .isConsensusEstablished()
          .then((result) => {
            setChecks((c) => ({ ...c, isConsensusEstablished: 'ok' }))
            append(`isConsensusEstablished() resolved: ${JSON.stringify(result)}`)
          })
          .catch((err) => {
            setChecks((c) => ({ ...c, isConsensusEstablished: 'error' }))
            append(`isConsensusEstablished() rejected: ${String(err)}`)
          })
      })
      .catch((err) => {
        setChecks((c) => ({ ...c, init: 'error' }))
        append(`init() rejected: ${String(err)}`)
      })
  }, [])

  return (
    <main style={{ fontFamily: 'monospace', padding: '1.5rem' }}>
      <h1>Payback — Mini App load test</h1>
      <p>Step 2 diagnostic screen: confirms the SDK loads and read-only provider calls resolve inside Nimiq Pay.</p>
      <ul>
        <li>init(): {checks.init}</li>
        <li>listAccounts(): {checks.listAccounts}</li>
        <li>isConsensusEstablished(): {checks.isConsensusEstablished}</li>
      </ul>
      <pre>{log.join('\n')}</pre>
    </main>
  )
}

export default App
