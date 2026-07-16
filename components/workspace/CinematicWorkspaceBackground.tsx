export function CinematicWorkspaceBackground() {
  return (
    <div className="workspace-atmosphere" aria-hidden="true">
      <div className="workspace-atmosphere__grid" />
      <div className="workspace-atmosphere__glow workspace-atmosphere__glow--cyan" />
      <div className="workspace-atmosphere__glow workspace-atmosphere__glow--red" />
      <div className="workspace-atmosphere__glow workspace-atmosphere__glow--violet" />
      <div className="workspace-atmosphere__ribbon workspace-atmosphere__ribbon--primary" />
      <div className="workspace-atmosphere__ribbon workspace-atmosphere__ribbon--secondary" />
      <div className="workspace-atmosphere__shade" />
      <div className="workspace-atmosphere__noise" />
    </div>
  );
}
