FROM python:3.12-slim

WORKDIR /app

# Install pipenv
RUN pip install pipenv

# Copy Pipfile and install dependencies
COPY Pipfile* ./
RUN pipenv install --ignore-pipfile

# Copy application code
COPY . .

EXPOSE 5001

CMD ["pipenv", "run", "python", "app.py"]