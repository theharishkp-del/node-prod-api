import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { LoadingService } from '../../services/loading.service';

@Component({
  selector: 'app-full-screen-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './full-screen-loader.html',
  styleUrl: './full-screen-loader.css',
})
export class FullScreenLoader {
  protected readonly loadingService = inject(LoadingService);
}
