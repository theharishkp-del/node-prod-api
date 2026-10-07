import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CountryOption } from '../../utils/country-options';

@Component({
  selector: 'app-country-code-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './country-code-select.html',
  styleUrls: ['./country-code-select.css'],
})
export class CountryCodeSelect {
  @Input({ required: true }) options: CountryOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Select country code';
  @Input() panelWidthClass = 'w-full';
  @Input() buttonClass = 'form-select w-full';
  @Input() disabled = false;
  @Input() valueChange: (value: string) => void = () => {};

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly searchTerm = signal('');

  readonly filteredOptions = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();

    if (!search) {
      return this.options;
    }

    return this.options.filter((option) =>
      `${option.dialCode} ${option.name} ${option.code}`.toLowerCase().includes(search)
    );
  });

  get selectedOption(): CountryOption | undefined {
    return this.options.find((option) => option.dialCode === this.value);
  }

  toggleDropdown(): void {
    if (this.disabled) {
      return;
    }

    const nextState = !this.isOpen();
    this.isOpen.set(nextState);

    if (nextState) {
      queueMicrotask(() => {
        this.searchInput?.nativeElement.focus();
      });
    } else {
      this.searchTerm.set('');
    }
  }

  selectOption(option: CountryOption): void {
    this.valueChange(option.dialCode);
    this.isOpen.set(false);
    this.searchTerm.set('');
  }

  updateSearch(term: string): void {
    this.searchTerm.set(term);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target instanceof Node)) {
      return;
    }

    if ((event.currentTarget as Document | null) && !this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
      this.searchTerm.set('');
    }
  }

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}
}
