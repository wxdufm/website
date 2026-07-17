import { useBackground } from './BackgroundContext'
import AnimatedBackgroundShader from './AnimatedBackgroundShader'


// The fixed, GPU-shader animated background that sits behind every page. Split out of
// _app so it can read the footer's on/off toggle (backgroundEnabled) — the graphic
// always drifts while mounted; the toggle is what stops it.
export default function SiteBackground() {
    const { backgroundEnabled } = useBackground()

    if (!backgroundEnabled) return null

    return (
        <>
            <div className="hidden lg:block">
                <AnimatedBackgroundShader size={17} />
            </div>
            <div className="lg:hidden">
                <AnimatedBackgroundShader size={12} />
            </div>
            {/* Global legibility scrim: one semi-transparent black layer over the whole
                animated background so text is readable everywhere, instead of per-section
                boxes. Sits above the canvas (z-0) and below page content (z-10). Tune the
                /60 opacity to trade legibility against how vivid the background reads. */}
            <div className="pointer-events-none fixed inset-0 z-[1] bg-black/60" aria-hidden="true" />
        </>
    )
}
