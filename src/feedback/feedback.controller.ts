import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Patch,
  Request,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { Public } from '../custom_decorator/public.decorator';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @Public()
  @ApiOperation({ summary: 'Submit feedback' })
  @ApiResponse({ status: 201, description: 'Feedback submitted successfully.' })
  async submitFeedback(@Body() dto: CreateFeedbackDto, @Request() req: any) {
    const ipAddress = req.ip;
    return this.feedbackService.submitFeedback(dto, ipAddress);
  }

  @Get()
  @ApiSecurity('access-token')
  @ApiOperation({ summary: 'Get feedback for the current user' })
  @ApiResponse({ status: 200, description: 'Feedback fetched successfully.' })
  async getUserFeedback(@Request() req: any) {
    return this.feedbackService.getFeedbackByUser(req.user.id);
  }

  @Patch(':id/status')
  @ApiSecurity('access-token')
  @ApiOperation({ summary: 'Update feedback status' })
  @ApiParam({ name: 'id', required: true, description: 'Feedback id' })
  @ApiResponse({
    status: 200,
    description: 'Feedback status updated successfully.',
  })
  async updateFeedbackStatus(
    @Param('id') feedbackId: string,
    @Body() body: { status: string },
  ) {
    return this.feedbackService.updateFeedbackStatus(feedbackId, body.status);
  }
}
