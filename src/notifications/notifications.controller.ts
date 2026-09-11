import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';
import { PushTokenService, InvalidExpoTokenError } from './push-token.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { UnregisterPushTokenDto } from './dto/unregister-push-token.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

@ApiTags('Notifications')
@ApiSecurity('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly pushTokens: PushTokenService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  @Post('tokens')
  @ApiOperation({ summary: 'Register (or refresh) a device push token' })
  @ApiResponse({ status: 201, description: 'Token registered.' })
  @ApiResponse({ status: 400, description: 'Invalid Expo push token.' })
  async registerToken(
    @Body() dto: RegisterPushTokenDto,
    @Request() req: AuthenticatedRequest,
  ) {
    try {
      const token = await this.pushTokens.register(req.user.id, dto);
      return { id: token.id, platform: token.platform, enabled: token.enabled };
    } catch (error) {
      if (error instanceof InvalidExpoTokenError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post('tokens/unregister')
  @ApiOperation({ summary: 'Remove a device push token (e.g. on logout)' })
  @ApiResponse({ status: 200, description: 'Token removed.' })
  async unregisterToken(
    @Body() dto: UnregisterPushTokenDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.pushTokens.unregister(req.user.id, dto.token);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get the current user notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences fetched.' })
  async getPreferences(@Request() req: AuthenticatedRequest) {
    return this.preferences.getOrCreate(req.user.id);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update the current user notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated.' })
  async updatePreferences(
    @Body() dto: UpdateNotificationPreferenceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.preferences.update(req.user.id, dto);
  }
}
