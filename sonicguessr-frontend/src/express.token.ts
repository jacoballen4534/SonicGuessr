import { InjectionToken } from '@angular/core';
import { Request, Response } from 'express';

export const REQUEST = new InjectionToken<Request>('REQUEST');
export const RESPONSE = new InjectionToken<Response>('RESPONSE');
export const SERVER_REQUEST_TOKEN = new InjectionToken<Request>('SERVER_REQUEST_OBJECT');
