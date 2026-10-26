import { Injectable } from "@nestjs/common";
import type { ListStopsQuery, StopDetail } from "@hadir/contracts";
import { AppError } from "../../common/errors/app-error";
import {
  StopsRepository,
  type RouteListQuery,
  type RouteListResult,
  type RouteRecord,
  type RouteStopRecord,
  type StopListResult,
} from "../../db/repositories/stops.repository";

@Injectable()
export class StopsService {
  constructor(private readonly stops: StopsRepository) {}

  async list(query: ListStopsQuery): Promise<StopListResult> {
    return this.stops.list(query);
  }

  async getById(id: string): Promise<StopDetail> {
    const stop = await this.stops.findById(id);
    if (stop === null) {
      throw new AppError('NOT_FOUND', { detail: 'Halte tidak ditemukan.' });
    }
    return stop;
  }

  async getByCode(code: string): Promise<StopDetail> {
    const stop = await this.stops.findByCode(code);
    if (stop === null) {
      throw new AppError('NOT_FOUND', { detail: 'Halte tidak ditemukan.' });
    }
    return stop;
  }

  async listRoutes(query: RouteListQuery): Promise<RouteListResult> {
    return this.stops.listRoutes(query);
  }

  async getRoute(id: string): Promise<RouteRecord> {
    const route = await this.stops.findRouteById(id);
    if (route === null) {
      throw new AppError('NOT_FOUND', { detail: 'Koridor tidak ditemukan.' });
    }
    return route;
  }

  async listRouteStops(id: string): Promise<{ route: RouteRecord; stops: RouteStopRecord[] }> {
    const route = await this.getRoute(id);
    const stops = await this.stops.listRouteStops(route.id);
    return { route, stops };
  }
}