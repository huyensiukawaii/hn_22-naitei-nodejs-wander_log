import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SignUpDto } from './dto/signup.dto';
import { SignInDto } from './dto/signin.dto';
import { hash, compare } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { randomBytes } from 'crypto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailsService } from 'src/mails/mails.service';

@Injectable()
export class AuthService {

  constructor(
    private prisma: PrismaService, 
    private jwtService: JwtService,
    private readonly i18n: I18nService,
    private readonly mailsService: MailsService
  ) {}

  async signUp(signUpDto: SignUpDto) {
    const { email, password, name } = signUpDto;
        
    const userExists = await this.prisma.user.findUnique({
      where: { email },
    });

    if (userExists) {
      throw new ConflictException(
        this.i18n.t('auth.email_exists', { lang: I18nContext.current()?.lang })
      );
    }

    const passwordHash = await hash(password, 10);
    const user = await this.prisma.user.create({
        data: { email, passwordHash, name },
    });

    const payload = { sub: user.id, email: user.email };
    const token = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    };
  }

  async signIn(signInDto: SignInDto) {
    const { email, password } = signInDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(
        this.i18n.t('auth.invalid_credentials', { lang: I18nContext.current()?.lang })
      );
    }

    const passwordValid = await compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException(
        this.i18n.t('auth.invalid_credentials', { lang: I18nContext.current()?.lang })
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        this.i18n.t('auth.account_disabled', { lang: I18nContext.current()?.lang })
      );
    }

    const payload = { sub: user.id, email: user.email };
    const token = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException(
        this.i18n.t('auth.user_not_found', { lang: I18nContext.current()?.lang })
      );
    }

    const resetToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000);

    await this.prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });
    
    await this.mailsService.forgotPassword({
      to: user.email,
      data: {
        token: resetToken,
        user_name: user.name || user.email.split('@')[0],
      },
    });

    return {
      message: this.i18n.t('auth.reset_password_email_sent', { lang: I18nContext.current()?.lang })
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;
    
    const passwordReset = await this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!passwordReset) {
      throw new BadRequestException(
        this.i18n.t('auth.invalid_reset_token', { lang: I18nContext.current()?.lang })
      );
    }

    if (passwordReset.expiresAt < new Date()) {
      await this.prisma.passwordReset.delete({
        where: { id: passwordReset.id },
      });
      throw new BadRequestException(
        this.i18n.t('auth.reset_token_expired', { lang: I18nContext.current()?.lang })
      );
    }

    const passwordHash = await hash(newPassword, 10);
    
    await this.prisma.user.update({
      where: { id: passwordReset.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordReset.delete({
      where: { id: passwordReset.id },
    });

    return {
      message: this.i18n.t('auth.password_reset_success', { lang: I18nContext.current()?.lang })
    };
  }
}