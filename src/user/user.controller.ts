import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Request,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPasswordDto } from './dto/user-password.dto';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('User')
@ApiSecurity('access-token')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  private assertSelfOrAdmin(targetUserId: string, req: any) {
    if (req.user.id !== targetUserId && req.user.role !== 'admin') {
      throw new ForbiddenException('Cannot access another user');
    }
  }

  private assertAdmin(req: any) {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse({ status: 201, description: 'User created successfully.' })
  create(@Body() dto: CreateUserDto, @Request() req: any) {
    return this.userService.create(dto, req.ip, req.headers['user-agent']);
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully.' })
  changePassword(@Body() dto: UserPasswordDto, @Request() req: any) {
    dto.userId = req.user.id;
    return this.userService.changePassword(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all users (admin only)' })
  @ApiResponse({ status: 200, description: 'Users fetched successfully.' })
  @ApiResponse({ status: 403, description: 'Admin access required.' })
  findAll(@Request() req: any) {
    this.assertAdmin(req);
    return this.userService.findAll();
  }

  @Get('deletion-status')
  @ApiOperation({ summary: 'Get account deletion status' })
  @ApiResponse({
    status: 200,
    description: 'Deletion status fetched successfully.',
  })
  async getDeletionStatus(@Request() req: any) {
    return this.userService.getDeletionStatus(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiParam({ name: 'id', required: true, description: 'User id' })
  @ApiResponse({ status: 200, description: 'User fetched successfully.' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    this.assertSelfOrAdmin(id, req);
    return this.userService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a user by id' })
  @ApiParam({ name: 'id', required: true, description: 'User id' })
  @ApiResponse({ status: 200, description: 'User updated successfully.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Request() req: any,
  ) {
    this.assertSelfOrAdmin(id, req);
    return this.userService.update(id, dto, req.ip, req.headers['user-agent']);
  }

  @Delete(':id/initiate')
  @ApiOperation({ summary: 'Initiate account deletion' })
  @ApiParam({ name: 'id', required: true, description: 'User id' })
  @ApiResponse({ status: 200, description: 'Account deletion initiated.' })
  initiateAccountDeletion(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    this.assertSelfOrAdmin(id, req);
    return this.userService.initiateAccountDeletion(
      id,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post(':id/cancel-deletion')
  @ApiOperation({ summary: 'Cancel account deletion' })
  @ApiParam({ name: 'id', required: true, description: 'User id' })
  @ApiResponse({ status: 200, description: 'Account deletion canceled.' })
  cancelAccountDeletion(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    this.assertSelfOrAdmin(id, req);
    return this.userService.cancelAccountDeletion(
      id,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user by id' })
  @ApiParam({ name: 'id', required: true, description: 'User id' })
  @ApiResponse({ status: 200, description: 'User deleted successfully.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    this.assertSelfOrAdmin(id, req);
    return this.userService.remove(id, req.ip, req.headers['user-agent']);
  }
}
