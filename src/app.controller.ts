import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './custom_decorator/public.decorator';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Root' })
  @ApiResponse({ status: 200, description: 'Service is running.' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({
    status: 200,
    description: 'Service and database are healthy.',
  })
  @ApiResponse({
    status: 503,
    description: 'Service unhealthy (e.g. database down).',
  })
  health() {
    return this.appService.healthCheck();
  }
}
