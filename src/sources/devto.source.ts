import { Injectable } from '@nestjs/common';
import { RssSource } from './rss-source.js';

@Injectable()
export class DevtoSource extends RssSource {
  readonly id = 'devto';
  protected feedUrl(tag: string): string {
    return `https://dev.to/feed/tag/${tag}`;
  }
}
