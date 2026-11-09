import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminDeleteUserDto } from './dto/admin-delete-user.dto';
import { AdminFindUsersDto } from './dto/admin-find-users.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/roles.constants';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';

@ApiTags('Admin')
@ApiSecurity('access-token')
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({
    summary: 'List users (admin only)',
    description:
      'Returns id, email, name, role, createdAt and deletion-schedule fields for users, optionally filtered by an email substring. Use it to find the ids of accounts to delete.',
  })
  @ApiResponse({ status: 200, description: 'Matching users.' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin.' })
  findUsers(@Query() query: AdminFindUsersDto) {
    return this.adminService.findUsers(query.email);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Immediately and permanently delete a user (admin only)',
    description:
      "Deletes the user and all of their data now, skipping the 30-day grace period of self-service deletion. This cannot be undone. The request body must repeat the target user's email in confirmEmail.",
  })
  @ApiParam({ name: 'id', required: true, description: 'User id (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'User deleted; returns counts of removed rows.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid id, confirmEmail mismatch, or the admin targeted their own account.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an admin, or the target is an admin.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  hardDeleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDeleteUserDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.adminService.hardDeleteUser(
      id,
      dto.confirmEmail,
      { id: req.user.id, email: req.user.email },
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
  }
}
