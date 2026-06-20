export interface GreetingRequest {
  name: string;
}

export function createGreeting(request: GreetingRequest): string {
  return `Hello, ${request.name}`;
}
