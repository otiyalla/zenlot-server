import { IsNumber, IsString, MinLength, IsOptional } from "class-validator";

export class UserPasswordDto {
    /**
     * Optional and only honoured for the caller's own id or by an admin. The
     * mobile client still sends it, so it stays in the DTO (the global
     * ValidationPipe uses `forbidNonWhitelisted`); when omitted the
     * authenticated user's id is used.
     */
    @IsNumber()
    @IsOptional()
    userId?: number;
    
    @IsString()
    @MinLength(8)
    currentPassword: string;

    @IsString()
    @MinLength(8)
    newPassword: string;

    @IsString()
    @IsOptional()
    @MinLength(8)
    confirmPassword?: string;
}
