import { FREE_BEAT_LIMIT } from '@boombapbot/contracts';
import { CircleUserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  EMAIL_ALREADY_VERIFIED,
  EMAIL_NOT_VERIFIED,
  MIN_PASSWORD_LENGTH,
  attempt,
  authClient,
  explain,
  type Failure,
} from '../account/client';
import { takeParams } from './arrival';
import { TextField } from './fields';
import { Modal } from './Modal';
import { SavedBeats } from './SavedBeats';

type View =
  | { name: 'log-in' }
  | { name: 'sign-up' }
  | { name: 'forgot' }
  | { name: 'check-inbox'; email: string }
  | { name: 'reset-sent'; email: string }
  | { name: 'new-password'; token: string };

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

type Go = (view: View, notice?: Notice) => void;

/** Coming back from a link in an email: which one, and whether it still worked. */
interface Arrival {
  kind: 'verified' | 'reset';
  token: string | null;
  failed: boolean;
}

/** Reads what an emailed link left in the address, and takes it back out. */
function takeArrival(): Arrival | null {
  const { account: kind, token, error } = takeParams(['account', 'token', 'error']);
  if (kind !== 'verified' && kind !== 'reset') return null;
  return { kind, token, failed: error !== null };
}

function arrivalView({ kind, token, failed }: Arrival): [View, Notice?] {
  if (kind === 'verified') {
    return failed
      ? [{ name: 'log-in' }, { kind: 'error', text: 'That confirmation link has expired. Log in to get a new one.' }]
      : [{ name: 'log-in' }, { kind: 'ok', text: 'Your email is confirmed.' }];
  }
  return token && !failed
    ? [{ name: 'new-password', token }]
    : [{ name: 'forgot' }, { kind: 'error', text: 'That reset link has expired or was already used. Ask for a new one.' }];
}

/** One call to the server at a time, with what went wrong kept for showing. */
function useAttempt() {
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (call: () => Promise<Failure | null>) => {
    setWaiting(true);
    setProblem(null);
    const failure = await call();
    setWaiting(false);
    setProblem(failure ? explain(failure) : null);
  };
  return { waiting, problem, run };
}

function Problem({ text }: { text: string | null }) {
  return (
    <p className="sb-form-problem" role="alert" data-testid="account-problem">
      {text}
    </p>
  );
}

type FieldName = 'email' | 'password';

interface FieldProps {
  name: FieldName;
  label: string;
  autoComplete: 'email' | 'current-password' | 'new-password';
}

function Field({ name, label, autoComplete }: FieldProps) {
  const choosing = autoComplete === 'new-password';
  return (
    <TextField
      label={label}
      name={name}
      type={name}
      testId={`account-${name}`}
      autoComplete={autoComplete}
      minLength={choosing ? MIN_PASSWORD_LENGTH : undefined}
      hint={choosing ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
    />
  );
}

interface FormProps {
  testId: string;
  action: string;
  /** The button's words while the server is answering. */
  busy: string;
  /** Returns what went wrong, or null once it worked. */
  submit(values: Record<FieldName, string>): Promise<Failure | null>;
  children: ReactNode;
}

function Form({ testId, action, busy, submit, children }: FormProps) {
  const { waiting, problem, run } = useAttempt();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: FieldName) => String(data.get(name) ?? '');
    void run(() => submit({ email: value('email').trim(), password: value('password') }));
  };
  return (
    <form className="sb-form" data-testid={testId} onSubmit={onSubmit}>
      {children}
      <Problem text={problem} />
      <button className="sb-button sb-button-primary" type="submit" data-testid="account-submit" disabled={waiting}>
        {waiting ? busy : action}
      </button>
    </form>
  );
}

function LinkButton({ testId, onClick, children }: { testId: string; onClick(): void; children: ReactNode }) {
  return (
    <button className="sb-link" type="button" data-testid={testId} onClick={onClick}>
      {children}
    </button>
  );
}

function LogIn({ go }: { go: Go }) {
  return (
    <>
      <p className="sb-modal-text">
        An account is free. It keeps up to {FREE_BEAT_LIMIT} of your beats, so you can pick them up on another device.
        The machine works the same without one.
      </p>
      <Form
        testId="account-log-in"
        action="Log in"
        busy="Logging in…"
        submit={async ({ email, password }) => {
          const failure = await attempt(() => authClient.signIn.email({ email, password }));
          if (failure?.code === EMAIL_NOT_VERIFIED) {
            go({ name: 'check-inbox', email });
            return null;
          }
          if (!failure) go({ name: 'log-in' });
          return failure;
        }}
      >
        <Field name="email" label="Email" autoComplete="email" />
        <Field name="password" label="Password" autoComplete="current-password" />
      </Form>
      <p className="sb-account-links">
        <LinkButton testId="account-to-sign-up" onClick={() => go({ name: 'sign-up' })}>
          Make an account
        </LinkButton>
        <LinkButton testId="account-to-forgot" onClick={() => go({ name: 'forgot' })}>
          Forgot your password?
        </LinkButton>
      </p>
    </>
  );
}

function SignUp({ go, baseUrl }: { go: Go; baseUrl: string }) {
  return (
    <>
      <p className="sb-modal-text">
        I only email you to confirm the address or to reset a password. The{' '}
        <a className="sb-link" href={`${baseUrl}policies`}>
          policies page
        </a>{' '}
        says what I keep.
      </p>
      <Form
        testId="account-sign-up"
        action="Make an account"
        busy="Making it…"
        submit={async ({ email, password }) => {
          const failure = await attempt(() =>
            authClient.signUp.email({ email, password, name: '', callbackURL: `${baseUrl}?account=verified` }),
          );
          if (!failure) go({ name: 'check-inbox', email });
          return failure;
        }}
      >
        <Field name="email" label="Email" autoComplete="email" />
        <Field name="password" label="Password" autoComplete="new-password" />
      </Form>
      <p className="sb-account-links">
        <LinkButton testId="account-to-log-in" onClick={() => go({ name: 'log-in' })}>
          I already have one
        </LinkButton>
      </p>
    </>
  );
}

function CheckInbox({ email, go, baseUrl }: { email: string; go: Go; baseUrl: string }) {
  const { waiting, problem, run } = useAttempt();
  const [sentAgain, setSentAgain] = useState(false);
  const sendAgain = () =>
    run(async () => {
      setSentAgain(false);
      const failure = await attempt(() =>
        authClient.sendVerificationEmail({ email, callbackURL: `${baseUrl}?account=verified` }),
      );
      if (failure?.code === EMAIL_ALREADY_VERIFIED) {
        go({ name: 'log-in' }, { kind: 'ok', text: 'That address is already confirmed. Log in.' });
        return null;
      }
      setSentAgain(!failure);
      return failure;
    });
  return (
    <div data-testid="account-check-inbox">
      <p className="sb-modal-text">
        Check <strong>{email}</strong> for a link from me. Open it and you are in. It works for an hour.
      </p>
      <p className="sb-modal-text">Nothing after a few minutes? Look in spam, then send it again.</p>
      <div className="sb-form">
        <Problem text={problem} />
        <button className="sb-button" type="button" data-testid="account-resend" disabled={waiting} onClick={sendAgain}>
          {waiting ? 'Sending…' : 'Send it again'}
        </button>
        <p className="sb-hint" role="status" data-testid="account-resent">
          {sentAgain ? 'Sent again.' : ''}
        </p>
      </div>
      <p className="sb-account-links">
        <LinkButton testId="account-to-sign-up" onClick={() => go({ name: 'sign-up' })}>
          Use a different address
        </LinkButton>
        <LinkButton testId="account-to-log-in" onClick={() => go({ name: 'log-in' })}>
          Log in
        </LinkButton>
      </p>
    </div>
  );
}

function Forgot({ go, baseUrl }: { go: Go; baseUrl: string }) {
  return (
    <>
      <p className="sb-modal-text">Tell me the address on your account and I will send a link to choose a new password.</p>
      <Form
        testId="account-forgot"
        action="Send the link"
        busy="Sending…"
        submit={async ({ email }) => {
          const failure = await attempt(() =>
            authClient.requestPasswordReset({ email, redirectTo: `${baseUrl}?account=reset` }),
          );
          if (!failure) go({ name: 'reset-sent', email });
          return failure;
        }}
      >
        <Field name="email" label="Email" autoComplete="email" />
      </Form>
      <p className="sb-account-links">
        <LinkButton testId="account-to-log-in" onClick={() => go({ name: 'log-in' })}>
          Back to log in
        </LinkButton>
      </p>
    </>
  );
}

function ResetSent({ email, go }: { email: string; go: Go }) {
  return (
    <div data-testid="account-reset-sent">
      <p className="sb-modal-text">
        If <strong>{email}</strong> has an account, a link to choose a new password is on its way. It works for an
        hour.
      </p>
      <p className="sb-account-links">
        <LinkButton testId="account-to-log-in" onClick={() => go({ name: 'log-in' })}>
          Back to log in
        </LinkButton>
      </p>
    </div>
  );
}

function NewPassword({ token, go }: { token: string; go: Go }) {
  return (
    <>
      <p className="sb-modal-text">Choose a new password for your account.</p>
      <Form
        testId="account-new-password"
        action="Save the new password"
        busy="Saving…"
        submit={async ({ password }) => {
          const failure = await attempt(() => authClient.resetPassword({ newPassword: password, token }));
          if (!failure) go({ name: 'log-in' }, { kind: 'ok', text: 'Password changed. Log in with the new one.' });
          return failure;
        }}
      >
        <Field name="password" label="New password" autoComplete="new-password" />
      </Form>
      <p className="sb-account-links">
        <LinkButton testId="account-to-log-in" onClick={() => go({ name: 'log-in' })}>
          Never mind
        </LinkButton>
      </p>
    </>
  );
}

interface SignedInProps {
  email: string;
  /** The account's public id. */
  account: string;
  baseUrl: string;
  close(): void;
}

function SignedIn({ email, account, baseUrl, close }: SignedInProps) {
  const { waiting, problem, run } = useAttempt();
  return (
    <div data-testid="account-signed-in">
      <p className="sb-modal-text">
        Logged in as <strong data-testid="account-address">{email}</strong>. Saving puts a copy of the beat on the
        machine in your account, so you can pick it up on another device. Nothing goes there until you save.
      </p>
      <SavedBeats baseUrl={baseUrl} account={account} close={close} />
      <div className="sb-form sb-account-leave">
        <Problem text={problem} />
        <button
          className="sb-button"
          type="button"
          data-testid="account-log-out"
          disabled={waiting}
          onClick={() => run(() => attempt(() => authClient.signOut()))}
        >
          {waiting ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </div>
  );
}

function Unreachable({ retry }: { retry(): void }) {
  return (
    <div data-testid="account-unreachable">
      <p className="sb-modal-text">
        I cannot reach the account server right now. The machine does not need it: everything you make is still
        saved in this browser, and you can export the project file from settings.
      </p>
      <div className="sb-form">
        <button className="sb-button" type="button" data-testid="account-retry" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  );
}

interface AccountProps {
  /** Base URL the site is served from, ending in a slash. */
  baseUrl: string;
  /** Where the modal mounts, so it inherits the page's theme. */
  container: RefObject<HTMLElement | null>;
}

/** The account button in the footer and its modal: log in, sign up, reset a password, saved beats, log out. */
export function Account({ baseUrl, container }: AccountProps) {
  const session = authClient.useSession();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ name: 'log-in' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const go: Go = (next, said) => {
    setView(next);
    setNotice(said ?? null);
  };

  useEffect(() => {
    const arrival = takeArrival();
    if (!arrival) return;
    const [next, said] = arrivalView(arrival);
    setView(next);
    setNotice(said ?? null);
    setOpen(true);
  }, []);

  const body = () => {
    if (view.name === 'new-password') return <NewPassword token={view.token} go={go} />;
    if (session.data) {
      const { email, id } = session.data.user;
      return <SignedIn email={email} account={id} baseUrl={baseUrl} close={() => setOpen(false)} />;
    }
    if (session.error) return <Unreachable retry={() => void session.refetch()} />;
    if (session.isPending) {
      return (
        <p className="sb-modal-text" role="status">
          Checking whether you are logged in…
        </p>
      );
    }
    switch (view.name) {
      case 'log-in':
        return <LogIn go={go} />;
      case 'sign-up':
        return <SignUp go={go} baseUrl={baseUrl} />;
      case 'forgot':
        return <Forgot go={go} baseUrl={baseUrl} />;
      case 'check-inbox':
        return <CheckInbox email={view.email} go={go} baseUrl={baseUrl} />;
      case 'reset-sent':
        return <ResetSent email={view.email} go={go} />;
    }
  };

  return (
    <Modal
      label={session.data ? 'Account, logged in' : 'Account'}
      tip="Account"
      title="Your account"
      testId="account"
      icon={<CircleUserRound />}
      container={container}
      className={session.data ? 'sb-ico-account sb-signed-in' : 'sb-ico-account'}
      open={open}
      onOpenChange={setOpen}
    >
      {notice && (
        <div className="sb-notice sb-account-notice" data-kind={notice.kind} data-testid="account-notice">
          <p role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>
        </div>
      )}
      {body()}
    </Modal>
  );
}
