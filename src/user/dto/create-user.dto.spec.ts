import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

const nameErrors = async (fname: string, lname = 'Garcia') => {
  const errors = await validate(
    plainToInstance(CreateUserDto, { fname, lname }),
  );
  return errors
    .map((error) => error.property)
    .filter((property) => property === 'fname' || property === 'lname');
};

describe('CreateUserDto names', () => {
  it.each(["O'Brien", 'José-María', 'J. R.', 'St.John', '李雷', 'Ana Maria'])(
    'accepts %s',
    async (name) => {
      expect(await nameErrors(name, name)).toEqual([]);
    },
  );

  it.each(['<b>Ana</b>', 'https://evil.com', 'WWW.evil.com', 'Ana\r\nBcc'])(
    'rejects %j',
    async (name) => {
      expect(await nameErrors(name, name)).toEqual(['fname', 'lname']);
    },
  );
});
