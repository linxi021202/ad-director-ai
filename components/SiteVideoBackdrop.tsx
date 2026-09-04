const BACKDROP_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260217_030345_246c0224-10a4-422c-b324-070b7c0eceda.mp4";

export function SiteVideoBackdrop() {
  return (
    <div className="site-video-backdrop" aria-hidden="true">
      <video className="site-video-backdrop__media" autoPlay loop muted playsInline preload="metadata">
        <source src={BACKDROP_VIDEO_URL} type="video/mp4" media="(prefers-reduced-motion: no-preference)" />
      </video>
      <div className="site-video-backdrop__overlay" />
      <div className="site-video-backdrop__vignette" />
    </div>
  );
}
