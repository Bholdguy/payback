import { CreateRequest } from './screens/CreateRequest'
import { PayerView } from './screens/PayerView'

/**
 * No router library yet — there are exactly two routes (create, and a
 * request's payer view), so a path check is the whole router.
 */
function App() {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/)
  if (match) {
    return <PayerView requestId={match[1]} />
  }
  return <CreateRequest />
}

export default App
