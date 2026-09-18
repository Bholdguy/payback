import { CreateRequest } from './screens/CreateRequest'
import { RequestView } from './screens/RequestView'

/**
 * No router library yet — there are exactly two routes (create, and a
 * frozen request's read-only view), so a path check is the whole router.
 */
function App() {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/)
  if (match) {
    return <RequestView requestId={match[1]} />
  }
  return <CreateRequest />
}

export default App
