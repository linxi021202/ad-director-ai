type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export function SectionHeader({ eyebrow, title, description, align = "left" }: SectionHeaderProps) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow ? <div className="text-sm font-medium text-muted">{eyebrow}</div> : null}
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-mist md:text-3xl">{title}</h2>
      {description ? <p className="mt-3 text-sm leading-6 text-muted">{description}</p> : null}
    </div>
  );
}