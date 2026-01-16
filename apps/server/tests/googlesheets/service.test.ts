import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';

describe('GoogleSheetsService - Static Methods', () => {
    describe('hashRow', () => {
        it('should generate consistent hash for same row data', () => {
            const row = ['value1', 'value2', 'value3'];
            const hash1 = GoogleSheetsService.hashRow(row);
            const hash2 = GoogleSheetsService.hashRow(row);

            expect(hash1).toBe(hash2);
        });

        it('should generate different hash for different row data', () => {
            const row1 = ['value1', 'value2', 'value3'];
            const row2 = ['value1', 'value2', 'different'];

            const hash1 = GoogleSheetsService.hashRow(row1);
            const hash2 = GoogleSheetsService.hashRow(row2);

            expect(hash1).not.toBe(hash2);
        });

        it('should normalize whitespace in cells', () => {
            const row1 = ['  value1  ', 'value2', 'value3'];
            const row2 = ['value1', 'value2', 'value3'];

            const hash1 = GoogleSheetsService.hashRow(row1);
            const hash2 = GoogleSheetsService.hashRow(row2);

            expect(hash1).toBe(hash2);
        });

        it('should treat empty cells consistently', () => {
            const row1 = ['value1', '', 'value3'];
            const row2 = ['value1', null as any, 'value3'];

            const hash1 = GoogleSheetsService.hashRow(row1);
            const hash2 = GoogleSheetsService.hashRow(row2);

            // Both should normalize empty/null to empty string
            expect(hash1).toBe(hash2);
        });

        it('should handle empty row', () => {
            const row: string[] = [];
            const hash = GoogleSheetsService.hashRow(row);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should handle row with special characters', () => {
            const row = ['value|with|pipes', 'value\nwith\nnewlines', 'value\twith\ttabs'];
            const hash = GoogleSheetsService.hashRow(row);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBe(40); // SHA-1 produces 40 character hex string
        });
    });

    describe('getRedisKey', () => {
        it('should generate correct Redis key format', () => {
            const triggerId = 'trigger-abc-123';
            const key = GoogleSheetsService.getRedisKey(triggerId);

            expect(key).toBe('sheets:trigger:trigger-abc-123:rowhash');
        });

        it('should handle empty triggerId', () => {
            const key = GoogleSheetsService.getRedisKey('');

            expect(key).toBe('sheets:trigger::rowhash');
        });

        it('should preserve special characters in triggerId', () => {
            const triggerId = 'trigger-with-special_chars.123';
            const key = GoogleSheetsService.getRedisKey(triggerId);

            expect(key).toBe('sheets:trigger:trigger-with-special_chars.123:rowhash');
        });
    });
});

describe('GoogleSheetsService - Row Update Detection', () => {
    describe('hashRow behavior for change detection', () => {
        it('should detect row content change', () => {
            // Simulate original row
            const originalRow = ['John', 'Doe', 'john@example.com'];
            const originalHash = GoogleSheetsService.hashRow(originalRow);

            // Simulate updated row (email changed)
            const updatedRow = ['John', 'Doe', 'johndoe@example.com'];
            const updatedHash = GoogleSheetsService.hashRow(updatedRow);

            // Hashes should be different
            expect(originalHash).not.toBe(updatedHash);
        });

        it('should NOT detect change if row content is same', () => {
            const row1 = ['John', 'Doe', 'john@example.com'];
            const row2 = ['John', 'Doe', 'john@example.com'];

            expect(GoogleSheetsService.hashRow(row1)).toBe(GoogleSheetsService.hashRow(row2));
        });

        it('should detect order change', () => {
            const row1 = ['A', 'B', 'C'];
            const row2 = ['C', 'B', 'A'];

            expect(GoogleSheetsService.hashRow(row1)).not.toBe(GoogleSheetsService.hashRow(row2));
        });
    });
});
