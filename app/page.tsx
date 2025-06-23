import LogSyncForm from "../log-sync-form"
import { Navigation } from "../components/navigation"

export default function Page() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="flex flex-col items-center justify-center p-8 pt-16">
        <LogSyncForm />
      </main>
    </div>
  )
}
