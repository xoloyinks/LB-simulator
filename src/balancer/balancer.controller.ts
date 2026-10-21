import { Body, Controller, Delete, Get, MessageEvent, Param, ParseIntPipe, Patch, Post, Put, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { BalancerService } from './balancer.service';
import { ConfigDto, CreateServerDto } from './dto';

@Controller('api')
export class BalancerController {
  constructor(private readonly balancer: BalancerService) {}

  @Get('state') state() { return this.balancer.snapshot(); }

  @Sse('stream') stream(): Observable<MessageEvent> {
    return this.balancer.state$.pipe(map((data) => ({ data }) as MessageEvent));
  }

  @Post('servers') add(@Body() dto: CreateServerDto) { return this.balancer.add(dto); }
  @Patch('servers/:id/toggle') toggle(@Param('id', ParseIntPipe) id: number) { return this.balancer.toggle(id); }
  @Delete('servers/:id') remove(@Param('id', ParseIntPipe) id: number) { return this.balancer.remove(id); }
  @Put('config') config(@Body() dto: ConfigDto) { return this.balancer.configure(dto); }
  @Post('burst') burst() { this.balancer.burst(); return { ok: true }; }
  @Post('reset') reset() { this.balancer.reset(); return { ok: true }; }
}
