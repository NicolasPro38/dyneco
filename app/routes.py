from flask import Blueprint, render_template
import psycopg2
import os

main = Blueprint('main', __name__)

def get_db():
    return psycopg2.connect(os.getenv('DATABASE_URL'))

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/api/health')
def health():
    try:
        conn = get_db()
        conn.close()
        return {'status': 'ok', 'db': 'connected'}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}, 500
