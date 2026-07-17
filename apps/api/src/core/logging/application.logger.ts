import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class ApplicationLogger extends ConsoleLogger {
  constructor() {
    super('AIPilot', { timestamp: true });
  }
}
