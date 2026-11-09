import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  ParseIntPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPasswordDto } from './dto/user-password.dto';
import { CurrentUser } from '../custom_decorator/current-user.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { assertSelfOrAdmin } from '../auth/ownership';

/**
 * Every route here sits behind the global `AuthGuard`. Routes that act on a
 * specific account additionally require the caller to own that account or be
 * an admin (403 otherwise). No route returns the password hash.
 *
 * There is intentionally no `GET /user` list route: the mobile client does not
 * use one, and admins can list users via `GET /admin/users`.
 */
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UserPasswordDto,
  ) {
    if (!user) throw new UnauthorizedException('Authentication required');
    // Default to the caller; a body-supplied userId is only honoured when it
    // is the caller's own id or the caller is an admin.
    const targetId = dto.userId ?? user.id;
    assertSelfOrAdmin(user, targetId);
    return this.userService.changePassword(targetId, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    assertSelfOrAdmin(user, id);
    return this.userService.findOne(id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    assertSelfOrAdmin(user, id);
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    assertSelfOrAdmin(user, id);
    return this.userService.remove(id);
  }
}
