import Link from "next/link";
import styles from "./page.module.css";

const features = [
  {
    icon: "✳",
    title: "Think out loud",
    description: "Explore a career question in your own time. Chat requires an AI provider configured by the platform operator.",
  },
  {
    icon: "▤",
    title: "Shape your story",
    description: "Draft a structured resume, edit rich-text sections, and preview or print it when it feels ready.",
  },
  {
    icon: "◷",
    title: "Talk it through",
    description: "Browse consultant availability and request a session. Payment and scheduling integrations are operator-configured.",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span className={styles.brandMark}>CP</span>Career Platform</Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#workspace">The workspace</a>
          <a href="#approach">Our approach</a>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/login" className={styles.loginLink}>Sign in</Link>
          <Link href="/register" className={styles.navCta}>Create account</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A calmer way to navigate what’s next</p>
          <h1>Make space for the career you’re building.</h1>
          <p className={styles.subtitle}>A private place to collect your thoughts, shape your experience, and take the next step at your pace.</p>
          <div className={styles.ctas}>
            <Link className={styles.primary} href="/register">Create your workspace <span aria-hidden="true">↗</span></Link>
            <a className={styles.secondary} href="#workspace">Take a look around</a>
          </div>
          <p className={styles.honesty}>Your work stays yours. AI and payment features depend on provider setup by the platform operator.</p>
        </div>

        <div className={styles.heroPanel} aria-label="A preview of the career workspace">
          <div className={styles.panelCard}>
            <div className={styles.panelTop}><span className={styles.panelLogo}>+</span><span>YOUR NEXT CHAPTER</span><span className={styles.dot} /></div>
            <h2>A little more clarity, one step at a time.</h2>
            <div className={styles.progressLine}><span /></div>
            <div className={styles.checkRow}><span>01</span><div><strong>Collect your experience</strong><small>Keep the details in one place</small></div><b>✓</b></div>
            <div className={styles.checkRow}><span>02</span><div><strong>Explore a direction</strong><small>Make room for useful questions</small></div><b className={styles.unchecked}>○</b></div>
            <div className={styles.checkRow}><span>03</span><div><strong>Choose your next step</strong><small>Move when the time feels right</small></div><b className={styles.unchecked}>○</b></div>
            <div className={styles.panelNote}><span>✦</span> A workspace for thoughtful progress</div>
          </div>
          <span className={styles.decorCircle} aria-hidden="true" />
        </div>
      </section>

      <section id="workspace" className={styles.features}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>ONE WORKSPACE, YOUR PACE</p>
          <h2>Tools for the parts of a career journey that need a little care.</h2>
          <p>Start with what matters today. You can come back to the rest later.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature) => <article key={feature.title} className={styles.featureCard}>
            <div className={styles.featureIcon} aria-hidden="true">{feature.icon}</div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>)}
        </div>
      </section>

      <section id="approach" className={styles.approach}>
        <div className={styles.approachCopy}>
          <p className={styles.eyebrow}>NOT A RACE</p>
          <h2>Your career doesn’t have to be figured out all at once.</h2>
          <p>Save a thought. Make one edit. Ask for another perspective. Career Platform is here to help you keep the pieces together while you decide what comes next.</p>
          <Link className={styles.textLink} href="/register">Find your starting point <span aria-hidden="true">→</span></Link>
        </div>
        <div className={styles.approachQuote}><span>“</span><p>Clarity isn’t always a big revelation. Sometimes it’s just knowing which small step feels right.</p><small>YOUR WORKSPACE, WHEN YOU NEED IT</small></div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}><span className={styles.brandMark}>CP</span>Career Platform</Link>
        <span>A little more direction for the work ahead.</span>
        <Link href="/login">Sign in to your workspace →</Link>
      </footer>
    </main>
  );
}
