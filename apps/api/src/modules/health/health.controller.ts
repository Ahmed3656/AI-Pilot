import {
  Controller,
  Get,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Overall process health' })
  status() {
    return this.health.status();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return this.health.status();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async readiness() {
    const result = await this.health.readiness();
    if (result.status === 'error')
      throw new ServiceUnavailableException(result);
    return result;
  }
}
