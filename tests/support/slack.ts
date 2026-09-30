// Test-only transport. It never calls the network, including for failure cases.
export class FakeSlack {
  readonly requests: { url: string; method: string; body: string }[] = [];
  private responses: (Response | Error)[] = [];

  enqueue(response: Response | Error): void {
    this.responses.push(response);
  }

  fetch = async (request: Request): Promise<Response> => {
    this.requests.push({
      url: request.url,
      method: request.method,
      body: await request.clone().text(),
    });
    const next = this.responses.shift();
    if (!next) throw new Error('No fake Slack response configured');
    if (next instanceof Error) throw next;
    return next;
  };
}
