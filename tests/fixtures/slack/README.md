# Slack fixtures

All identifiers and URLs in command.json are synthetic. It is the decoded shape
of a form-encoded /snack command, not a JSON wire payload. tests/support/command.ts
encodes and signs it independently with Node's crypto implementation. Commands
only target local Workers. hooks.slack.invalid is never called.

The published verification vector in tests/unit/slack-signature.test.ts comes
from <https://docs.slack.dev/authentication/verifying-requests-from-slack/>.
That example's secret and response URL are public test data. No test contacts it.

tests/fixtures/worker.env contains synthetic secrets explicitly loaded by the
disposable browser servers; personal .dev.vars values are not used. Integration
tests override those bindings and prohibit external HTTP. Browser tests use a
separate fixed-clock Worker entry, which must never be deployed.

tests/support/slack.ts remains a fake outbound transport for future delivery work.
There is no outbound Slack sender in M1; replies are immediate HTTP responses.
Local contract tests do not prove that real Slack rendered or delivered a reply.
