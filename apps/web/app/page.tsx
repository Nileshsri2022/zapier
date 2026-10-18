import MainSection from '@/components/MainSection';
import ButtonLink from '@/components/ButtonLink';
import { APPS } from '@/components/modal/constants';

const FLOW = [
  {
    kind: 'When this happens',
    type: 'Webhook receives a POST',
    icon: APPS.find((a) => a.id === 'webhook')!.icon,
    action: false,
  },
  {
    kind: 'Then do this',
    type: 'Send a Gmail message',
    icon: APPS.find((a) => a.id === 'gmail')!.icon,
    action: true,
  },
  {
    kind: 'And this',
    type: 'Add a row to Google Sheets',
    icon: APPS.find((a) => a.id === 'sheets')!.icon,
    action: true,
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Pick a trigger',
    body: 'A new email, a webhook call, a schedule — whatever starts the work in one of your apps.',
  },
  {
    n: '2',
    title: 'Add actions',
    body: 'Send a message, update a sheet, create a calendar event. Chain as many steps as the job needs.',
  },
  {
    n: '3',
    title: 'Publish and watch it run',
    body: 'Your zap runs on its own from there. Every run is logged, so you can see exactly what happened.',
  },
];

export default function Home() {
  return (
    <MainSection>
      <main className="landing">
        <section className="landing-hero">
          <div>
            <h1 className="landing-title rise-in">Automate the busywork.</h1>
            <p className="landing-lede rise-in rise-in-1">
              ZapMate connects the apps you already use and moves the repetitive work between them —
              no developers, no IT tickets, no delays.
            </p>
            <div className="landing-ctas rise-in rise-in-2">
              <ButtonLink href="/sign-up" variant="primary" size="lg">
                Start building for free
              </ButtonLink>
              <ButtonLink href="/login" variant="outline" size="lg">
                Log in
              </ButtonLink>
            </div>
            <p className="landing-proof rise-in rise-in-3">
              Free for core features. Set up your first zap in minutes.
            </p>
          </div>

          {/* A real zap, drawn the way the editor draws it */}
          <div
            className="flow-chain rise-in rise-in-2"
            aria-label="Example zap: webhook to Gmail to Google Sheets"
          >
            <div className="flow-chain-head">
              <span className="flow-chain-name">New lead follow-up</span>
              <span className="flow-live">Live</span>
            </div>
            {FLOW.map((s, i) => (
              <div key={s.type}>
                {i > 0 && (
                  <div
                    className={i === 1 ? 'flow-link flow-link--in' : 'flow-link'}
                    aria-hidden="true"
                  />
                )}
                <div className={s.action ? 'flow-step flow-step--action' : 'flow-step'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.icon} alt="" width={28} height={28} />
                  <div>
                    <div className="flow-step-kind">{s.kind}</div>
                    <div className="flow-step-type">{s.type}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="how">
          <h2 id="how" className="landing-h2">
            Three steps between you and done
          </h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="step-num">{s.n}</span>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" aria-labelledby="apps">
          <h2 id="apps" className="landing-h2">
            Works with the tools on your desk
          </h2>
          <p className="landing-sub">
            Triggers and actions for the apps teams live in, plus webhooks and schedules to connect
            anything else.
          </p>
          <ul className="apps-list">
            {APPS.map((a) => (
              <li key={a.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.icon} alt="" width={24} height={24} loading="lazy" />
                {a.name}
                <span className="apps-note">
                  {a.category === 'flow-controls' ? 'Flow control' : 'Trigger & action'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-cta">
          <h2>Your first zap is closer than the next manual task.</h2>
          <ButtonLink href="/sign-up" variant="primary" size="lg">
            Create your free account
          </ButtonLink>
        </section>

        <footer className="landing-footer">
          <span>ZapMate — automate without limits.</span>
          <span>
            <a href="/login">Log in</a> · <a href="/sign-up">Sign up</a>
          </span>
        </footer>
      </main>
    </MainSection>
  );
}
