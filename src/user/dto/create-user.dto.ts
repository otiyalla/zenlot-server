import { IsEmail, IsObject, IsOptional, IsArray, IsString, MinLength } from 'class-validator';

class ForexRuleDto {
    @IsArray()
    takeProfit: {
        pips: number;
    }[];

    @IsArray()
    stopLoss: {
        pips: number;
    }[];
}

export class RulesDto {
    forex: ForexRuleDto;
}

export class CreateUserDto {
    @IsString()
    fname: string;
    
    @IsString()
    lname: string;

    @IsEmail()
    email: string;
    
    @IsString()
    language: string;

    @IsString()
    @IsOptional()
    role: string;
    
    @IsString()
    accountCurrency: string;

    @IsObject()
    rules: RulesDto;

    @IsString()
    @MinLength(8)
    password: string;

}