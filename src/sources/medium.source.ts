import { Injectable } from '@nestjs/common';
import { RssSource } from './rss-source.js';

@Injectable()
export class MediumSource extends RssSource {
  readonly id = 'medium';
  protected feedUrl(tag: string): string {
    return `https://medium.com/feed/tag/${tag}`;
  }
}
