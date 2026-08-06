import { IsIn, IsString, MaxLength } from 'class-validator';

export class HistoryTurnDto {
  @IsIn(['interviewer', 'tony'])
  role: 'interviewer' | 'tony';

  @IsString()
  @MaxLength(4000)
  text: string;
}
