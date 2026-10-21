import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ALGORITHMS } from './strategies';
import { AlgoName } from './types';

export class CreateServerDto {
  @IsOptional() @IsString() @MaxLength(24) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10) weight?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) capacity?: number;
}

export class ConfigDto {
  @IsOptional() @IsIn(ALGORITHMS) algorithm?: AlgoName;
  @IsOptional() @IsInt() @Min(0) @Max(200) rate?: number;
}
