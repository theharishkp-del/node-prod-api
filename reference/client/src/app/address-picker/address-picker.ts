import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, forwardRef, inject, Input, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { waitForGoogleMaps } from '../utils/google-maps-ready.util';
import { environment } from '../../environments/environment';

export interface AddressValue {
  formattedAddress: string;
  lat: number | null;
  lng: number | null;
}

@Component({
  selector: 'app-address-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './address-picker.html',
  styleUrls: ['./address-picker.css'],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AddressPicker), multi: true },
  ],
})
export class AddressPicker implements AfterViewInit, ControlValueAccessor {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  @Input() label = 'Address';
  @Input() required = false;

  @ViewChild('autocompleteInput') autocompleteInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('autocompleteHost') autocompleteHostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('mapContainer') mapContainerRef?: ElementRef<HTMLDivElement>;

  searchText = '';
  showMapPopup = false;
  touched = false;
  disabled = false;
  useNewAutocomplete = environment.maps.useNewPlacesAutocomplete;

  private map: any;
  private marker: any;
  private geocoder: any;
  private autocomplete: any;
  private placeAutocompleteElement: any;
  private pendingLatLng: { lat: number; lng: number } | null = null;

  value: AddressValue = { formattedAddress: '', lat: null, lng: null };

  private onChange: (val: AddressValue) => void = () => {};
  private onTouchedCb: () => void = () => {};

  ngAfterViewInit(): void {
    waitForGoogleMaps().then(() => {
      this.geocoder = new (window as any).google.maps.Geocoder();
      if (this.useNewAutocomplete) {
        void this.initPlaceAutocompleteElement();
        return;
      }

      this.initLegacyAutocomplete();
    });
  }

  private async initPlaceAutocompleteElement(): Promise<void> {
    const google = (window as any).google;

    try {
      const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');

      this.placeAutocompleteElement = new PlaceAutocompleteElement({
        placeholder: 'Search address',
      });
      this.placeAutocompleteElement.className = 'block w-full';
      this.autocompleteHostRef.nativeElement.replaceChildren(this.placeAutocompleteElement);

      this.placeAutocompleteElement.addEventListener('gmp-select', async ({ placePrediction }: any) => {
        const place = placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });

        if (!place.location) {
          return;
        }

        const lat = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
        const lng = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;

        this.searchText = place.formattedAddress || place.displayName || '';
        this.openMapPopup(lat, lng);
      });
    } catch (error) {
      console.warn('Falling back to legacy Google Places autocomplete.', error);
      this.useNewAutocomplete = false;
      this.changeDetectorRef.detectChanges();
      this.initLegacyAutocomplete();
    }
  }

  private initLegacyAutocomplete(): void {
    const google = (window as any).google;

    if (!this.autocompleteInputRef?.nativeElement) {
      return;
    }

    this.autocomplete = new google.maps.places.Autocomplete(this.autocompleteInputRef.nativeElement, {
      fields: ['formatted_address', 'geometry', 'name'],
    });

    this.autocomplete.addListener('place_changed', () => {
      const place = this.autocomplete.getPlace();
      if (!place.geometry?.location) {
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      this.searchText = place.formatted_address || place.name || '';
      this.openMapPopup(lat, lng);
    });
  }

  openMapManually(): void {
    const lat = this.value.lat ?? 20.5937;
    const lng = this.value.lng ?? 78.9629;
    this.openMapPopup(lat, lng);
  }

  private openMapPopup(lat: number, lng: number): void {
    this.ngZone.run(() => {
      this.showMapPopup = true;
      this.pendingLatLng = { lat, lng };
      this.changeDetectorRef.detectChanges();
      this.scheduleMapRender(lat, lng);
    });
  }

  private scheduleMapRender(lat: number, lng: number, attempts = 0): void {
    setTimeout(() => {
      if (!this.mapContainerRef?.nativeElement) {
        if (attempts < 5) {
          this.scheduleMapRender(lat, lng, attempts + 1);
        }
        return;
      }

      this.renderMap(lat, lng);
    }, 0);
  }

  private renderMap(lat: number, lng: number): void {
    if (!this.mapContainerRef?.nativeElement) {
      return;
    }

    const google = (window as any).google;
    const center = { lat, lng };

    this.map = new google.maps.Map(this.mapContainerRef.nativeElement, { center, zoom: 16 });
    this.marker = new google.maps.Marker({ position: center, map: this.map, draggable: true });

    this.marker.addListener('dragend', () => {
      const pos = this.marker.getPosition();
      this.pendingLatLng = { lat: pos.lat(), lng: pos.lng() };
      this.reverseGeocode(pos.lat(), pos.lng());
    });

    this.map.addListener('click', (e: any) => {
      this.marker.setPosition(e.latLng);
      this.pendingLatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      this.reverseGeocode(e.latLng.lat(), e.latLng.lng());
    });
  }

  private reverseGeocode(lat: number, lng: number): void {
    this.geocoder.geocode({ location: { lat, lng } }, (results: any, status: string) => {
      if (status === 'OK' && results[0]) this.searchText = results[0].formatted_address;
    });
  }

  confirmLocation(): void {
    if (!this.pendingLatLng) return;
    this.value = { formattedAddress: this.searchText, lat: this.pendingLatLng.lat, lng: this.pendingLatLng.lng };
    this.onChange(this.value);
    this.markTouched();
    this.showMapPopup = false;
  }

  cancelPopup(): void { this.showMapPopup = false; }
  markTouched(): void { this.touched = true; this.onTouchedCb(); }

  writeValue(val: AddressValue): void {
    this.value = val || { formattedAddress: '', lat: null, lng: null };
    this.searchText = this.value.formattedAddress || '';
  }
  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouchedCb = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }
}
