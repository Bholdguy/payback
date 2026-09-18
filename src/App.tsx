import { CreateRequest } from './screens/CreateRequest'
import { PayerView } from './screens/PayerView'
import { RequesterDashboard } from './screens/RequesterDashboard'

/**
 * No router library yet — there are exactly three routes (create, a
 * request's payer view, and the requester dashboard), so a path check is the
 * whole router.
 */
function App() {
  const path = window.location.pathname

  const match = path.match(/^\/r\/([^/]+)$/)
  if (match) {
    return <PayerView requestId={match[1]} />
  }

  if (path === '/dashboard') {
    return <RequesterDashboard />
  }

  return <CreateRequest />
}

export default App
