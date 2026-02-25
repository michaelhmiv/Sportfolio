declare global {
  namespace Express {
    interface User {
      id?: string;
      claims?: {
        sub?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
      };
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
