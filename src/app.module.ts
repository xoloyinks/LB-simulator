import { Module } from '@nestjs/common';
import { BalancerController } from './balancer/balancer.controller';
import { BalancerService } from './balancer/balancer.service';

@Module({ controllers: [BalancerController], providers: [BalancerService] })
export class AppModule {}
