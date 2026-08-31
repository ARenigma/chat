import { sizedStorageImageUri } from '../src/lib/storageImage';

describe('sizedStorageImageUri', () => {
  it('routes public Storage objects through the transform endpoint', () => {
    expect(
      sizedStorageImageUri(
        'https://demo.supabase.co/storage/v1/object/public/avatars/ada.jpg',
        188,
        70,
        3,
        75,
      ),
    ).toBe(
      'https://demo.supabase.co/storage/v1/render/image/public/avatars/ada.jpg' +
        '?width=564&height=210&resize=cover&quality=75',
    );
  });

  it('preserves a signed token while adding dimensions', () => {
    const result = sizedStorageImageUri(
      'https://demo.supabase.co/storage/v1/object/sign/avatars/ada.jpg?token=secret',
      48,
      48,
      2,
    );
    const url = new URL(result);

    expect(url.pathname).toBe('/storage/v1/render/image/sign/avatars/ada.jpg');
    expect(url.searchParams.get('token')).toBe('secret');
    expect(url.searchParams.get('width')).toBe('96');
    expect(url.searchParams.get('height')).toBe('96');
  });

  it('caps dimensions at Supabase limits and leaves other CDNs alone', () => {
    expect(
      sizedStorageImageUri(
        'https://demo.supabase.co/storage/v1/object/public/avatars/ada.jpg',
        1280,
        900,
        3,
      ),
    ).toContain('width=2500&height=2500');
    expect(
      sizedStorageImageUri('https://images.example.com/ada.jpg', 48, 48, 3),
    ).toBe('https://images.example.com/ada.jpg');
  });
});
