import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-[0.2em] text-white">AIRLOCK++</h1>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/30">
            Geospatial Reconstruction
          </p>
        </div>

        <button
          onClick={() => navigate('/input')}
          className="rounded-full border border-white/15 bg-white/5 px-10 py-3.5 text-sm font-medium text-white/80 backdrop-blur-md transition-all hover:border-white/40 hover:text-white hover:shadow-glow"
        >
          Enter Application
        </button>
      </div>
    </div>
  )
}
